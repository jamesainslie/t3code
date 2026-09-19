# GitHub account routing: per-repository `gh` account selection

Repo: jamesainslie/t3code (fork of pingdotgg/t3code). Base: fork `main` at `33a7e5d8f`.
Branch: `github-account-routing`. Upstream discussion: https://github.com/pingdotgg/t3code/discussions/12572

This document has two parts. Part A is the design and the facts it rests on. Part B is the
implementation plan: file by file, with anchors, code shapes, tests, commands, and acceptance
checks per phase. Each phase is one commit, written test first.

---

# Part A: design

## A1. Problem

`gh` supports several accounts per host. T3 Code uses one account per host: whichever
`gh auth status` reports as active (`GitHubSourceControlProvider.findAuthenticatedGitHubAccount`).
On a machine with a personal and a work account on github.com, every repository visible only to
the inactive account fails every `gh` call. Symptoms: `ThreadPullRequestReactor` retries `gh pr list`
once a minute per checkout and logs a full stack trace each time; the sidebar never shows linked
PRs for those projects; the PR panel treats the host as one viewer.

## A2. Decisions (James, 2026-09-19)

- Model: environment-level ordered **owner pattern rules** plus a **per-project override**.
  Project override wins, then first matching rule, then `null` (gh's active account). Single-account
  users see no change.
- Build in the fork now; propose upstream in parallel.
- Name: **"GitHub account"** (`gitHubAccount*`). Not "GitHub routing": upstream uses that for
  cross-machine PR access (`GitHubRoutingSettings`, `githubRoutingPermissions`).
- Git network operations (clone, push, pull) are out of scope for v1 (section A9).
- Rules reorder with move up and move down buttons; no drag and drop.
- Rules are edited on web and desktop; mobile gets the project override and a read-only rules view.

## A3. Facts established during research

- `gh` 2.101 on the machines involved. `gh auth status --json hosts` (gh 2.81+, already required
  by upstream's probe) returns per host `{ state, active, login, tokenSource, scopes, gitProtocol }`.
  `gh auth token --hostname <host> --user <login>` returns an inactive account's token (verified).
- The server never reads `GH_TOKEN` from the environment. Pinning exists:
  `GitHubCli.PinnedGitHubCredential` (`apps/server/src/sourceControl/GitHubCli.ts:32-36`), a
  `Context.Reference<{ host, token, credentialFingerprint } | null>`; `executeRaw` (`:403-439`) overlays
  `GH_HOST`, `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_DEBUG: ""`.
- Guard: `targetsVerifiedHost` (`GitHubCli.ts:43-73`) rejects a pinned command whose argv names no
  host. Today's only pin producer always passes `--repo host/owner/name` or `--hostname`.
- Choke point 1: `GitHubPullRequestCli.captureVerifiedCredential`
  (`apps/server/src/pullRequest/GitHubPullRequestCli.ts:1078-1145`) runs
  `["auth", "token", "--hostname", host]` (`:1090`), fingerprints `host:sha256(token)` (`:1097`),
  caches identity per fingerprint 10 min (`routingIdentities`, `:1062`).
- Choke point 2: `SourceControlProviderRegistry.bindProviderContext`
  (`apps/server/src/sourceControl/SourceControlProviderRegistry.ts:155-198`) wraps every provider
  method with the detected context; `resolveHandle` (`:261-279`) calls it for every cwd. All 13
  `GitManager` call sites go through it.
- Bypass: `GitHubMediaFetch.githubToken` (`apps/server/src/assets/GitHubMediaFetch.ts:66-98`) caches
  `gh auth token` per host; comment at `:70-72` says a pin belongs in the key. Caller has the asset cwd.
- `PullRequestService.SupportedProject` (`apps/server/src/pullRequest/PullRequestService.ts:302-314`)
  carries `host`; `resolveViewers` (`:976-1015`) caches per host (`viewersByHost`, `:930`) and races
  `getViewer` across all roots of a host (`Effect.firstSuccessOf`, `:943`).
- `RepositoryIdentityResolver.resolve(cwd)` (`apps/server/src/project/RepositoryIdentityResolver.ts:182`)
  yields `owner`, `name`, `canonicalKey` (host/owner/name), `rootPath`, cached. Host derivation
  precedent: `pullRequestHostOf` (`PullRequestService.ts:738-741`).
- No cwd-to-project lookup exists. Shell snapshot (`ProjectionSnapshotQuery`) has project
  `workspaceRoot` and thread `worktreePath`.
- Settings pattern (mirror `c4ca1b0f9`): `PROJECT_SCOPED_SERVER_SETTING_KEYS`
  (`packages/contracts/src/settings.ts:990-1009`), `ProjectSettingsOverrides` (`:1016-1035`, closed by
  `satisfies Record<ProjectScopedServerSettingKey, unknown>`), `ServerSettings` (`:1049-1241`, defaults
  via `Schema.withDecodingDefault`), `ServerSettingsPatch` (`:1394-1512`), capability flags
  (`packages/contracts/src/environment.ts:108-120`). `applyServerSettingsPatch`
  (`packages/shared/src/serverSettings.ts:262-380`) deep-merges arrays index-wise, so list settings
  are replaced explicitly (`defaultProjectScripts`, `:368-370`). Whole-value comparison keys:
  `ATOMIC_SETTINGS_KEYS` (`apps/server/src/serverSettings.ts:354-360`).
- Override convention: absent key inherits; patch entries replace a project's whole override set;
  clear = delete the key. Web "Inherit" select precedent:
  `apps/web/src/components/settings/StorageSettings.tsx:168-194`.
- Project defaults panel: `apps/web/src/components/settings/ProjectDefaultsSettings.tsx`, hooks at
  `:49-75` (`useSettingsScope`, `useScopedSettings`, `useUpdateScopedSettings`, `useScopedSettingsMixed`,
  `isProjectScope`), source-control branch starts at `:340`.
- Web discovery data: `SourceControlDiscoveryResult.sourceControlProviders` items are
  `SourceControlProviderDiscoveryItem` (`packages/contracts/src/sourceControl.ts:145-149`) with
  `auth: SourceControlProviderAuth` (`:121-127`, single `account`). Full list is parsed by
  `parseGitHubAuthStatus` (`apps/server/src/sourceControl/gitHubAuthStatus.ts:20-40`, fields
  `host, account, authenticated, active, error`) and discarded at `GitHubSourceControlProvider.ts:61`.
- Project records carry `repositoryIdentity?: { canonicalKey, owner?, name?, provider?, ... }`
  (`packages/contracts/src/environment.ts:208-216`, referenced from `orchestration.ts:524, 849`).
- Mobile: `apps/mobile/src/features/settings/SettingsServerControlsRouteScreen.tsx`,
  `PAGE_PROJECT_KEYS` (`:45-50`), source-control body (`:262-285`), `ChoiceRow` (`:378-420`),
  `write()`/`clearProjectOverrides()`/`uniform()`/`disabledFor()` helpers in `ServerSettingsDetail`.
- Reactor: `pendingBackfill` map (`ThreadPullRequestReactor.ts:85-95`), group key
  `[projectId, worktreePath, branch]` (`:127-129`), warning (`:290-296`), schedule (`:352-365`).
- Tests fake `gh` via `Layer.mock(VcsProcess.VcsProcess)({ run })` dispatching on argv and env
  (`GitHubCli.test.ts:110-137`, `GitHubPullRequestCli.test.ts:222-258`,
  `SourceControlDiscovery.test.ts:380-395` for the auth JSON fixture).
- Server layer wiring: `apps/server/src/server.ts:284-289` (`SourceControlProviderRegistryLayerLive`
  provides `GitHubCli.layer`), `:334` (`PullRequestServiceLive`), `:499`.
- No glob dependency exists; owner matching is hand-written.
- User docs: `docs/user/source-control.md` (sections "Connect an account" > "GitHub" at line 12,
  "Linked pull requests" at 148), `docs/user/project-settings.md`.

## A4. Data model

```ts
GitHubAccountRule = { host: string /* default "github.com" */, owner: string /* pattern */, login: string }
ServerSettings.gitHubAccountRules: ReadonlyArray<GitHubAccountRule>      // ordered, default []
ProjectSettingsOverrides.gitHubAccount?: string                            // login; absent = inherit
SourceControlProviderAuth.accounts?: ReadonlyArray<{ host, login, active, authenticated }>
EnvironmentCapabilities.gitHubAccountRouting?: boolean
```

Owner pattern grammar: one or more of `[A-Za-z0-9._-]` and `*`; `*` matches any run of characters;
matching is case-insensitive; the whole owner must match. No other syntax.

## A5. Resolution order

```
resolveGitHubAccount({ rules, projectOverride, host, owner }):
  projectOverride ?? firstMatch(rules, host, owner)?.login ?? null
```

`null` means "no pin; gh's active account", which is today's behavior.

## A6. Server architecture

New service `GitHubAccountSelector` (`apps/server/src/sourceControl/GitHubAccountSelector.ts`):

- `forCheckout({ cwd, projectId? })` resolves `{ host, login } | null` from `RepositoryIdentityResolver`
  plus settings; when `projectId` is absent, finds the project whose `workspaceRoot` equals the
  identity `rootPath`, else the thread whose `worktreePath` equals it (shell snapshot), cached 30 s.
- `pinFor({ cwd, projectId? })` returns a `PinnedGitHubCredential` value or `null`, fetching the token
  with `gh auth token --hostname <host> --user <login>`, cached per `(host, login)` for 5 min,
  evicted on auth failure. Fingerprint `host:login:sha256(token)`. Pin scope `"checkout"`.

Applied at both choke points and the two derived places (media fetch, viewer grouping). Checkout-scoped
pins relax `targetsVerifiedHost` for host-less argv only.

## A7. Client architecture

Web: rules editor section at environment scope (only when the environment lists two or more
authenticated GitHub accounts), project override `Select` with Inherit on the source-control project
row, resolved-inherit label computed client-side with the same shared resolver. Mobile: project
override `ChoiceRow` group plus read-only rules summary.

## A8. Surfaces checklist

- Entry points: Settings only.
- Clients: web/desktop full; mobile override plus read-only rules.
- Providers: GitHub only; selector returns `null` for others.
- Contracts: settings, patch, overrides, capability, discovery `accounts`.
- Reverse states: Inherit clears the override; empty rules restore today's behavior; environment-scope
  "Reset all" already clears project overrides.
- Connection modes: server settings, so identical over local, relay, and tunnel; capability gating for
  older servers.
- Docs: two user docs; no internals page (selector comment carries the precedence).

## A9. Out of scope, follow-ups

- Git network operations. Follow-up: pass `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=credential.https://<host>.username`,
  `GIT_CONFIG_VALUE_0=<login>` to git for routed checkouts so `gh auth git-credential` picks the same account.
- `owner/name` patterns if owner rules prove too coarse.
- Upstreaming: reactor logging first (tiny), then routing, if #12572 gets traction.

---

# Part B: implementation plan

Conventions for every phase: create tests first and watch them fail, then implement, then
`vp test run <files>` and the targeted typecheck listed. Never repo-wide checks. Conventional
commit titles. No `Co-Authored-By`. No em-dashes in code, comments, docs, or commit messages.

Setup:

```bash
cd /Volumes/Code/t3code-fork && git checkout main && git pull --ff-only
git checkout -b github-account-routing
```

Typecheck commands (per package, use as listed in each phase):

```bash
node_modules/.bin/vp run --filter @t3tools/contracts typecheck
node_modules/.bin/vp run --filter @t3tools/shared typecheck
node_modules/.bin/vp run --filter t3 typecheck
node_modules/.bin/vp run --filter @t3tools/web typecheck
node_modules/.bin/vp run --filter @t3tools/mobile typecheck
node_modules/.bin/vp fmt --write <files> && node_modules/.bin/vp lint <files>
```

## Phase 0: contracts and shared resolver

Commit: `feat(settings): add GitHub account rules and per-project account override`

### 0.1 `packages/contracts/src/settings.ts`

Add near the other source-control value schemas (after `SourceControlWritingStyleSettings`, ~line 911):

```ts
/** A `gh` login on one host. Case is preserved for display; matching is case-insensitive. */
export const GitHubAccountLogin = TrimmedNonEmptyString;
export type GitHubAccountLogin = typeof GitHubAccountLogin.Type;

/** Repository owner pattern: literal characters plus `*` wildcards, matched against the whole owner. */
export const GitHubOwnerPattern = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9._*-]+$/, { description: "owner name or pattern using *" }),
);
export type GitHubOwnerPattern = typeof GitHubOwnerPattern.Type;

/** One routing rule. Rules are ordered; the first whose host and owner match wins. */
export const GitHubAccountRule = Schema.Struct({
  host: TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed("github.com"))),
  owner: GitHubOwnerPattern,
  login: GitHubAccountLogin,
});
export type GitHubAccountRule = typeof GitHubAccountRule.Type;

export const GitHubAccountRules = Schema.Array(GitHubAccountRule);
export type GitHubAccountRules = typeof GitHubAccountRules.Type;
```

Check the exact name of the regex check combinator in this Effect version before writing
(`grep -n "Schema.isPattern\|Schema.pattern" packages/contracts/src/*.ts` and
`.repos/effect-smol/packages/effect/src/Schema.ts`).

Then four coupled edits:

1. `PROJECT_SCOPED_SERVER_SETTING_KEYS` (`:990-1009`): append `"gitHubAccount"`.
2. `ProjectSettingsOverrides` (`:1016-1035`): add `gitHubAccount: Schema.optionalKey(GitHubAccountLogin),`.
   Non-nullable on purpose: clearing is always "delete the key".
3. `ServerSettings` (`:1049-1241`), next to `sourceControlWritingStyle` (`:1193`):
   `gitHubAccountRules: GitHubAccountRules.pipe(Schema.withDecodingDefault(Effect.succeed([]))),`
4. `ServerSettingsPatch` (`:1394-1512`): `gitHubAccountRules: Schema.optionalKey(GitHubAccountRules),`.

### 0.2 `packages/contracts/src/settings.test.ts`

Add tests (mirror the `worktreeCleanup` cases from `c4ca1b0f9`):

- "decodes GitHub account rules to an empty list by default"
- "defaults a rule's host to github.com"
- `it.each` "rejects owner patterns with spaces, slashes, or other syntax" for `"geico private"`,
  `"geico/private"`, `"a?b"`, `""`
- "stores a per-project GitHub account override and lists it as project-scoped"
- "patch accepts a full rule list and a project override entry"

### 0.3 `packages/contracts/src/environment.ts` (`:108-120`)

```ts
/** Server pins `gh` accounts per repository from `gitHubAccountRules` and project overrides. */
gitHubAccountRouting: Schema.optionalKey(Schema.Boolean),
```

### 0.4 `packages/contracts/src/sourceControl.ts` (`:121-127`)

```ts
export const SourceControlProviderAccount = Schema.Struct({
  host: TrimmedNonEmptyString,
  login: TrimmedNonEmptyString,
  active: Schema.Boolean,
  authenticated: Schema.Boolean,
});
export type SourceControlProviderAccount = typeof SourceControlProviderAccount.Type;

export const SourceControlProviderAuth = Schema.Struct({
  status: SourceControlProviderAuthStatus,
  account: Schema.Option(TrimmedNonEmptyString),
  host: Schema.Option(TrimmedNonEmptyString),
  detail: Schema.Option(TrimmedNonEmptyString),
  /** Every account the CLI knows for this provider; absent on servers that predate routing. */
  accounts: Schema.optionalKey(Schema.Array(SourceControlProviderAccount)),
});
```

Grep for every literal `SourceControlProviderAuth` construction in server tests
(`grep -rn "status: \"authenticated\"" apps/server/src --include="*.test.ts"`); since the key is
optional, existing fixtures keep compiling.

### 0.5 `packages/shared/src/gitHubAccountRouting.ts` (new) and `packages/shared/package.json`

```ts
import type { GitHubAccountRule } from "@t3tools/contracts";

/** `*` matches any run of characters; everything else is literal. Case-insensitive, whole-owner match. */
export function matchesOwnerPattern(pattern: string, owner: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i").test(owner);
}

export interface ResolveGitHubAccountInput {
  readonly rules: ReadonlyArray<GitHubAccountRule>;
  readonly projectOverride: string | undefined;
  readonly host: string;
  readonly owner: string;
}

/** Project override, then the first matching rule, then null for gh's active account. */
export function resolveGitHubAccount(input: ResolveGitHubAccountInput): string | null {
  if (input.projectOverride !== undefined) return input.projectOverride;
  const host = input.host.toLowerCase();
  const rule = input.rules.find(
    (candidate) =>
      candidate.host.toLowerCase() === host && matchesOwnerPattern(candidate.owner, input.owner),
  );
  return rule?.login ?? null;
}

/** Which rule (by index) "inherit" resolves to, for the settings UI label. */
export function matchingRuleIndex(rules, host, owner): number | null
```

`packages/shared/package.json` exports: add `"./gitHubAccountRouting": { "types": "./src/gitHubAccountRouting.ts", "import": "./src/gitHubAccountRouting.ts" }`
(mirror the `./projectSettings` entry; the package has no barrel).

Tests `packages/shared/src/gitHubAccountRouting.test.ts`:

- exact owner matches case-insensitively; `geico-*` matches `geico-private` and `GEICO-Sandbox`,
  not `mygeico-x`; `*` matches anything; regex metacharacters in owners are literal (`a.b` does not
  match `axb`)
- project override wins over a matching rule
- first matching rule wins over a later one
- host mismatch (`github.geico.net` vs `github.com`) skips the rule
- no match returns `null`
- `matchingRuleIndex` returns the index or `null`

### 0.6 `packages/shared/src/serverSettings.ts` (`applyServerSettingsPatch`, `:262-380`)

Destructure `gitHubAccountRules` out of the deep merge exactly like `defaultProjectScripts`
(`:368-370`) and replace it wholesale when present in the patch. Test in `serverSettings.test.ts`:
"replaces GitHub account rules as a whole instead of merging by index" (patch `[ruleB]` over
`[ruleA, ruleC]` yields `[ruleB]`).

### 0.7 `packages/shared/src/projectSettings.test.ts`

Add: "resolves a project GitHub account override with source project" and "clearing gitHubAccount
removes the key and drops an empty entry".

### 0.8 `apps/server/src/serverSettings.ts` (`ATOMIC_SETTINGS_KEYS`, `:354-360`)

Add `"gitHubAccountRules"` so default stripping compares the array whole. Existing test file covers
stripping; add one case if a sibling key has one.

### 0.9 Verify

```bash
node_modules/.bin/vp test run packages/contracts/src/settings.test.ts packages/shared/src/gitHubAccountRouting.test.ts packages/shared/src/serverSettings.test.ts packages/shared/src/projectSettings.test.ts apps/server/src/serverSettings.test.ts
node_modules/.bin/vp run --filter @t3tools/contracts --filter @t3tools/shared typecheck
```

Acceptance: new settings decode with defaults, overrides list the key, patches replace the list
whole, the resolver behaves per A5, typecheck green.

## Phase 1: server selector, pinning, viewer grouping, discovery accounts, capability

Commit: `feat(server): pin the gh account per repository from account rules and project overrides`

### 1.1 `apps/server/src/sourceControl/GitHubCli.ts`

- Widen the pin type (`:32-36`) with `readonly scope: "host" | "checkout"` (existing producer sets
  `"host"`; search all constructions: `GitHubPullRequestCli.ts:1098`, tests).
- `executeRaw` (`:403-439`): replace the guard with

```ts
if (credential !== null && !pinAllowsCommand(input.args, credential)) { ...same error... }
```

```ts
/** A checkout-scoped pin came from the checkout's own remote, so host-less argv runs against it. */
function pinAllowsCommand(args, credential): boolean {
  const hosts = commandHosts(args);
  if (hosts.length === 0) return credential.scope === "checkout";
  return hosts.every((host) => host === credential.host);
}
```

Tests (`GitHubCli.test.ts`, next to `:110-137`): "runs host-less commands under a checkout-scoped pin",
"rejects host-less commands under a host-scoped pin", "rejects a checkout pin whose argv names another host".

### 1.2 `apps/server/src/sourceControl/GitHubAccountSelector.ts` (new)

```ts
export class GitHubAccountSelector extends Context.Service<GitHubAccountSelector, {
  readonly forCheckout: (input: { readonly cwd: string; readonly projectId?: ProjectId }) =>
    Effect.Effect<{ readonly host: string; readonly login: string } | null>;
  readonly pinFor: (input: { readonly cwd: string; readonly projectId?: ProjectId }) =>
    Effect.Effect<PinnedGitHubCredentialValue | null>;
}>()("t3/sourceControl/GitHubAccountSelector") {}
```

Dependencies: `RepositoryIdentityResolver`, `ServerSettings.ServerSettingsService`,
`ProjectionSnapshotQuery`, `VcsProcess.VcsProcess`, `Clock`.

`forCheckout`:
1. `identity = yield* resolver.resolve(cwd)`; return `null` if none, if `identity.provider !== "github"`
   (confirm the provider value string used by `RepositoryIdentityResolver`), or if `owner` is missing.
2. `host = hostOf(identity.canonicalKey)` (reuse the `pullRequestHostOf` logic; move it to a small
   shared helper in `apps/server/src/project/repositoryIdentityHost.ts` if it is not already exported).
3. `settings = yield* serverSettings.getSettings`.
4. `projectId ??= yield* projectForRoot(identity.rootPath)` where `projectForRoot` reads the shell
   snapshot once per 30 s (`Cache.makeWith`, key `rootPath`) and matches `project.workspaceRoot === rootPath`
   or any thread with `worktreePath === rootPath`.
5. `projectOverride = projectId ? resolveProjectSettings(settings, projectId).settings.gitHubAccount : undefined`
   (confirm `resolveProjectSettings` surfaces the key; Phase 0 iterates `PROJECT_SCOPED_SERVER_SETTING_KEYS`, so it does).
6. `login = resolveGitHubAccount({ rules: settings.gitHubAccountRules, projectOverride, host, owner })`.
7. Return `login === null ? null : { host, login }`.

`pinFor`:
1. `selected = yield* forCheckout(input)`; `null` passes through.
2. Token cache `Map<"host\0login", { at, token: Redacted }>`, TTL 5 min, 32 entries FIFO (copy the
   shape of `GitHubMediaFetch.tokenCache`).
3. On miss run `VcsProcess.run({ operation: "GitHubAccountSelector.token", command: "gh",
   args: ["auth", "token", "--hostname", host, "--user", login], cwd, env: { GH_DEBUG: "" } })`;
   empty stdout or non-zero exit means `null` (log at debug once per key: "GitHub account has no token").
4. Return `{ host, token, credentialFingerprint: `${host}:${login}:${sha256(token)}`, scope: "checkout" }`.
5. Any downstream `GitHubCliAuthError` (see how `GitHubCli` classifies auth failures around `:99`)
   should evict the cache entry; simplest: expose `invalidate({ host, login })` and call it from the
   registry wrapper on auth errors.

Layer: `GitHubAccountSelector.layer`. Wire in `server.ts` next to `SourceControlProviderRegistryLayerLive`
(`:284-289`) and `PullRequestServiceLive` (`:334`); check `.repos/effect-smol/LLMS.md` for
`Context.Service` and `Layer.effect` shapes used elsewhere in the server (for example
`RepositoryIdentityResolver.layer` at `RepositoryIdentityResolver.ts:195`).

Tests `GitHubAccountSelector.test.ts`:
- routes by rule: fixture settings `rules: [{ owner: "geico-*", login: "work" }]`, identity owner
  `geico-private` yields `{ host: "github.com", login: "work" }`
- project override wins when `projectId` is given
- derives the project from the shell snapshot by `workspaceRoot` when `projectId` is absent
- returns `null` for a non-GitHub identity and for no match
- `pinFor` runs `gh auth token --hostname github.com --user work` once for two calls within the TTL
  (assert on the `VcsProcess` mock's recorded argv), fingerprint contains the login, `scope === "checkout"`
- `pinFor` returns `null` when `gh auth token` exits non-zero

### 1.3 `apps/server/src/sourceControl/SourceControlProviderRegistry.ts`

- `bindProviderContext` (`:155-198`): add a third parameter `pin: Effect.Effect<PinnedGitHubCredentialValue | null>`
  and wrap each delegated call: `provider.listChangeRequests({...}).pipe(withPin(pin))` where

```ts
const withPin = (pin) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(pin, (credential) =>
    credential === null ? effect : Effect.provideService(effect, GitHubCli.PinnedGitHubCredential, credential));
```

  Only wrap when `context.provider.kind === "github"`; other kinds pass through untouched.
- `resolveHandle` (`:261-279`): pass `selector.pinFor({ cwd: input.cwd })` (lazy; the token is fetched
  only when a method runs). `GitHubAccountSelector` becomes a dependency of the registry layer.
- `createRepository` has no cwd context; leave it unpinned (documented in a one-line comment).

Tests `SourceControlProviderRegistry.test.ts` (extend existing): "provides the checkout's pinned
credential to GitHub provider calls" (assert `GH_TOKEN` seen by the `VcsProcess` mock for
`pr list` equals the selector's token) and "leaves non-GitHub providers unpinned".

### 1.4 `apps/server/src/pullRequest/GitHubPullRequestCli.ts` (`captureVerifiedCredential`, `:1078-1145`)

- Input gains `readonly projectId?: ProjectId` (thread the value from callers that have it; the reactor
  and `PullRequestService` do; others omit it).
- Before the `gh auth token` call: `const selected = yield* selector.forCheckout({ cwd, projectId })`;
  if `selected !== null && selected.host === host`, append `"--user", selected.login` to the args and
  build `key` as `${host}:${selected.login}:${sha256(token)}`; pin `scope: "checkout"`. Otherwise
  keep today's behavior with `scope: "host"`.
- `GitHubAccountSelector` becomes a dependency of `GitHubPullRequestCli.layer`; wire in `server.ts`.

Tests (`GitHubPullRequestCli.test.ts`, near `:222-258`): "asks gh for the routed account's token"
(argv contains `--user work`), "fingerprints differ for two accounts on one host" (already partly
covered; extend with login), "unrouted checkouts keep asking for the active account" (no `--user`).

### 1.5 `apps/server/src/assets/GitHubMediaFetch.ts` (`:66-98`)

- `githubToken` takes the selector: `const selected = yield* selector.forCheckout({ cwd: input.cwd })`;
  `key = selected ? `${host}\0${selected.login}` : host`; add `"--user", selected.login` when selected.
- Update the comment at `:70-72` (the pin now lives in the key).
- Test: two cwds routed to different logins produce two cache entries and two `gh auth token` calls
  with different `--user`.

### 1.6 `apps/server/src/pullRequest/PullRequestService.ts`

- `SupportedProject` (`:302-314`): add `readonly account: string | null` and document that the account
  boundary is now `(host, account)`.
- Where `SupportedProject`s are built (`listWorkspaceProjects`, `:690-775`): resolve `account` via
  `selector.forCheckout({ cwd: project.workspaceRoot, projectId: project.id })`.
- `resolveViewers` (`:976-1015`): iterate distinct `(host, account)` pairs; `viewersByHost` and the
  flight key include the account; `roots` are the checkouts with that same account (fall back to
  `viewerRoots.get(host)` filtered by account); `ResolvedViewer` gains `account`.
- Follow the key through `listCursorKey` (`:755`), `viewerOf` (`:1440-1449`), and `credentialNamespace`
  (`:163-164, 2582, 2592, 2674, 3105-3109`): where a host key is built, build `${host}\0${account ?? ""}`.
- Tests (`PullRequestService.test.ts`): "keeps viewers separate for two accounts on one host" and
  "does not race checkouts routed to different accounts for one viewer lookup" (mock `getViewer`
  records `cwd`s; assert only same-account roots were tried).

### 1.7 `apps/server/src/sourceControl/GitHubSourceControlProvider.ts` (`parseGitHubAuth`, `:58-105`)

Populate `accounts` on every returned `providerAuth(...)`:

```ts
accounts: authStatus.accounts.map((entry) => ({
  host: entry.host, login: entry.account, active: entry.active, authenticated: entry.authenticated,
})),
```

Test (`SourceControlDiscovery.test.ts`, extend the fixture at `:380-395` with a second inactive
account): "lists every gh account with the active one flagged". Add a shared fixture builder
`gitHubAuthStatusJson(accounts)` in that test file for reuse.

### 1.8 `apps/server/src/environment/ServerEnvironment.ts`

Advertise `gitHubAccountRouting: true` next to `projectSettingsOverrides`. Update the capability
assertion in `ServerEnvironment.test.ts` if one enumerates flags.

### 1.9 `apps/server/src/orchestration/ThreadPullRequestReactor.ts`

Commit separately: `fix(server): log a persistent pull request lookup failure once per checkout`

- Beside `pendingBackfill` (`:85`): `const lookupFailures = new Map<string, { tag: string; count: number; since: number }>()`.
- In the `catchCause` at `:290-296`: compute `tag = Cause.squash(cause)` class name plus message
  first line; if `lookupFailures.get(groupKey)?.tag === tag`, increment and `Effect.logDebug` with
  `{ threadIds, count }`; otherwise set the entry and `Effect.logWarning` as today. On group success
  (where `finishBackfill(group)` is called), delete the entry.
- Hourly rollup: in the scheduled tick (`:352-365`), once per 60 cycles, `logWarning("thread branch
  pull request lookups still failing", { groups: [...lookupFailures].map(([key, v]) => ({ key, count: v.count, tag: v.tag })) })`
  when the map is non-empty.
- Tests (`ThreadPullRequestReactor.test.ts`): "warns once for a repeated identical failure and again
  after success then failure"; "logs a rollup after sixty cycles". Use the existing test harness's
  logger capture; check how other reactor tests assert logs (grep `logWarning` in that test file).

### 1.10 `apps/server/src/server.ts`

Add `GitHubAccountSelector.layer` to `SourceControlProviderRegistryLayerLive` (`:284-289`),
`GitHubPullRequestCli`'s layer, `PullRequestServiceLive` (`:334`), and the media route's layer.
Provide `RepositoryIdentityResolver.layer`, `ServerSettingsLayerLive`, and the projection snapshot
query where the selector is built (check for layer cycles: the selector must not depend on anything
that depends on the registry).

### 1.11 Verify

```bash
node_modules/.bin/vp test run apps/server/src/sourceControl apps/server/src/pullRequest/GitHubPullRequestCli.test.ts apps/server/src/pullRequest/PullRequestService.test.ts apps/server/src/assets apps/server/src/orchestration/ThreadPullRequestReactor.test.ts apps/server/src/environment
node_modules/.bin/vp run --filter t3 typecheck
```

Acceptance: a routed checkout's `gh` calls carry `--user` and a per-account `GH_TOKEN`; unrouted
checkouts behave exactly as before (no `--user`, host-scoped pin); host-less `pr list` runs under a
checkout pin; viewers are cached per account; discovery lists all accounts; the reactor logs a
persistent failure once plus hourly rollups.

## Phase 2: web

Commit: `feat(web): choose a GitHub account per repository owner and project`

### 2.1 `apps/web/src/components/settings/gitHubAccountSettings.logic.ts` (new, pure) + test

```ts
export interface GitHubAccountOption { login: string; host: string; active: boolean }
export function accountOptions(discovery: SourceControlDiscoveryResult): GitHubAccountOption[]   // github item's auth.accounts, authenticated only
export function addRule(rules, rule): GitHubAccountRules
export function removeRule(rules, index): GitHubAccountRules
export function moveRule(rules, index, direction: -1 | 1): GitHubAccountRules   // clamps at ends
export function updateRule(rules, index, patch: Partial<GitHubAccountRule>): GitHubAccountRules
export function validateOwnerPattern(value: string): string | null   // message or null; same regex as contracts
export function summarizeRules(rules): string   // "2 rules · geico-* → work" style, "Off" when empty
export function inheritedAccountLabel(input: { rules, host, owner, accounts }): string
  // "personal (rule geico-*)" | "gh active account" | "personal (not signed in)" when the login is missing
```

Tests: each function, including clamped moves, validation messages, and the inherit label variants.

### 2.2 `apps/web/src/components/settings/GitHubAccountRulesSettings.tsx` (new)

Environment-scope section rendered inside `SourceControlSettings.tsx` after the provider list and
before `SourceControlWritingSettingsSection` (`:603`). Props: none; reads `useSettingsScope()`,
`useScopedSettings()`, `useUpdateScopedSettings()`, and the representative environment's discovery
result (the page already holds `SourceControlDiscoveryResult` for the selected environment; pass it
down or read it the same way the provider list does).

Rendering rules:
- Hidden when the scope is a project or checkout (rules are environment-wide), when the environment
  lacks `capabilities.gitHubAccountRouting`, or when `accountOptions(...)` has fewer than two entries
  (then show one `SettingsRow` with description "Sign in to a second GitHub account with `gh auth login`
  on this machine to route repositories between accounts.").
- `SettingsSection` "GitHub accounts", `id` from `searchableSetting("github-account-rules")`.
- One `SettingsRow` per rule: `control` holds an owner `Input` (validated on blur, error text below),
  an account `Select` (options from `accountOptions`, active one labelled "(active)"), move up, move
  down, and remove icon buttons (`SettingResetButton`-style micro buttons; reuse existing icon button
  primitives, no new styling). Disabled states follow `unavailable`/`mixed` like other rows.
- Footer row: "Add rule" button that appends `{ host: "github.com", owner: "", login: firstOption }`
  in local draft state until the owner is valid, then writes.
- Writes: `updateSettings({ gitHubAccountRules: next })`. `useUpdateScopedSettings` already fans out
  to every connected environment at "All environments" scope; at one environment it writes there.
- Mixed values across environments (`useScopedSettingsMixed(["gitHubAccountRules"])`): show
  "Rules differ between machines" and disable editing until one machine is selected, matching how
  other list settings behave (check `ProjectActionsSettings.tsx` for the mixed pattern and copy it).

Component test `GitHubAccountRulesSettings.test.tsx` following `SourceControlWritingSettings.test.tsx`
conventions (`react-test-renderer`, mocked hooks): "adds a rule and writes the whole list",
"moves a rule down", "hides the editor with one account".

### 2.3 `apps/web/src/components/settings/ProjectDefaultsSettings.tsx` (source-control branch, `:340`)

Add a `SettingsRow` "GitHub account" modeled on `StorageSettings.tsx:168-194`:

- `serverScoped settingKeys={["gitHubAccount"]} mixed={useScopedSettingsMixed(["gitHubAccount"])}`.
- Visible at project and checkout scope only when the representative environment has the capability
  and at least one authenticated GitHub account; at environment scope render nothing (rules live in
  the section above).
- `Select` value: `settings.gitHubAccount ?? "inherit"`. Items: "Inherit" then one per account.
  `onValueChange`: `"inherit"` calls `clearSettings(["gitHubAccount"])`; a login calls
  `updateSettings({ gitHubAccount: login })`.
- Description: `inheritedAccountLabel({ rules: settings.gitHubAccountRules, host, owner, accounts })`
  where `host`/`owner` come from the project's `repositoryIdentity` (`target`'s project record; at
  checkout scope use the checkout's project). When identity is missing: "Applies to gh commands run in
  this project's checkouts."
- `useClearScopedSettings` is already imported in the file or its siblings; confirm.

Test: extend `scopedSettings.test.ts` with "writes a project GitHub account override" and "clears it
back to inherit" (pure planner tests, `:245-275` and `:372-395` patterns).

### 2.4 `apps/web/src/components/settings/settingsSearch.ts`

Add `github-account-rules` (title "GitHub accounts", scope environment defaults, page source control)
and `github-account` (title "GitHub account", scope project defaults). Check `SETTINGS_SEARCH_ITEMS`
shape at `:129` and the test that snapshots ids, if any.

### 2.5 Verify

```bash
node_modules/.bin/vp test run apps/web/src/components/settings/gitHubAccountSettings.logic.test.ts apps/web/src/components/settings/GitHubAccountRulesSettings.test.tsx apps/web/src/components/settings/scopedSettings.test.ts apps/web/src/components/settings/settingsSearch.test.ts
node_modules/.bin/vp run --filter @t3tools/web typecheck
```

Acceptance: with two accounts, the rules editor appears at environment scope and edits persist
through the real patch path; the project row offers Inherit plus accounts and shows what inherit
resolves to; with one account, no editor and a plain hint; search finds both settings.

## Phase 3: mobile

Commit: `feat(mobile): choose a project's GitHub account in source control settings`

### 3.1 `apps/mobile/src/features/settings/SettingsServerControlsRouteScreen.tsx`

- `PAGE_PROJECT_KEYS["source-control"]` (`:47`): append `"gitHubAccount"` so "Use defaults" clears it.
- In the source-control body (`:262-285`), after the Worktrees section, add
  `SettingsSection title="GitHub account"` rendered only when the target environments all report
  `capabilities.gitHubAccountRouting` and the selected scope is a project. Options: `ChoiceRow`
  "Inherit" (selected when `uniform("gitHubAccount") === undefined`) then one `ChoiceRow` per account
  from the environment's discovery result (find how mobile reads `SourceControlDiscoveryResult`; if it
  is not on the mobile environment model yet, read it the same way the Source control page shows
  connected providers, or add the discovery to the mobile environment presentation in
  `packages/client-runtime` if it already exists for web).
  `onPress`: inherit calls `clearProjectOverrides(["gitHubAccount"])` for the project; an account calls
  `write({ gitHubAccount: login })` (the shallow patch is fine: it is a scalar).
- At environment scope, render a read-only `SettingsSection title="GitHub account rules"` listing
  `owner → login` rows from `uniform("gitHubAccountRules")` with subtitle "Edit rules on web or desktop.";
  hidden when empty.

### 3.2 `apps/mobile/src/features/settings/settings-scoped-server.test.ts`

Add: "writes gitHubAccount into the project's overrides" and "clears gitHubAccount" using the existing
fixtures (`:32-93`).

### 3.3 Verify

```bash
node_modules/.bin/vp test run apps/mobile/src/features/settings/settings-scoped-server.test.ts
node_modules/.bin/vp run --filter @t3tools/mobile typecheck
```

Acceptance: project override selectable and clearable on mobile; rules visible read-only; nothing
shown against servers without the capability.

## Phase 4: docs, integrated pass, release

Commit: `docs(user): explain GitHub account rules and project overrides`

### 4.1 Docs

- `docs/user/source-control.md`, under "Connect an account" > "GitHub" (line 12): a subsection
  "Several GitHub accounts": sign in to each with `gh auth login` on the machine that runs the
  server; open Settings > Source control on that environment and add rules mapping repository owners
  to accounts, first match wins, `*` is a wildcard; a project can pick an account directly under its
  Source control settings; without a match T3 Code uses the account `gh` has active. One sentence:
  pushes and pulls still use git's credential helper.
- `docs/user/project-settings.md`: add "GitHub account" to the list of per-project overrides.

### 4.2 Integrated pass (web, with permission for a dev server)

- `test-t3-app` skill against a worktree `.t3` seeded from a `VACUUM INTO` copy of `~/.t3f/userdata`
  (never the live dir).
- Put a `gh` shim first on `PATH` for the dev server only: a script that answers
  `auth status --json hosts` with two accounts, `auth token --hostname github.com [--user X]` with
  `token-<user or active>`, `pr list ...` with an empty array when `GH_TOKEN` is `token-work` and a
  one-PR array otherwise, and `api user` with a login matching the token. Everything else exits 1.
- Verify: rules editor appears; adding `geico-* → work` persists after reload; a project whose owner
  matches shows "Inherits: work (rule geico-*)"; setting the project override to personal changes the
  PR list result; the server log shows `--user work` in the shim's call log for the routed project;
  the reactor warning appears once, not every minute, for a shim configured to fail.

### 4.3 Release and remote verification

- Merge `github-account-routing` into fork `main` (squash, per the personal-repo convention), let the
  nightly ship, update the fork desktop app.
- On the host that showed the warnings: add one rule mapping the work owner to the work login in the
  fork app's Settings for that environment; confirm the `thread branch pull request lookup failed`
  warnings stop and linked PRs appear in the sidebar for those threads.

## Definition of done

- All phase tests green; targeted typechecks green for contracts, shared, server, web, mobile.
- Fork CI green on `main` (Check, Test, Release Smoke).
- Nightly published; remote host verified per 4.3.
- Upstream discussion #12572 updated with a one-line pointer to the fork commits (no PII).

## Risks

- Merge surface with upstream: edits inside `GitHubCli.ts`, `GitHubPullRequestCli.ts`,
  `PullRequestService.ts`, `SourceControlProviderRegistry.ts`, and the settings schema. Keep each
  edit to one insertion point; new logic lives in new modules.
- `gh` version: `--user` needs gh 2.40+; `auth status --json` needs 2.81+ (already required). Missing
  `accounts` hides the UI.
- Token freshness: five-minute cache plus eviction on auth failure.
- Wrong-account writes: the project row shows the resolved account; rules are explicit and ordered.
- Version skew: capability flag; older fork servers ignore the keys.
- Layer cycles when wiring the selector: it depends on settings, identity resolver, and the snapshot
  query; none of those depend on the source-control registry, but confirm with the typecheck before
  restructuring.
