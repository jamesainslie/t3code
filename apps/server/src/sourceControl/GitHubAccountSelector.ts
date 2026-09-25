import * as NodeCrypto from "node:crypto";

import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { pullRequestHostOf, type ProjectId } from "@t3tools/contracts";
import { resolveGitHubAccount } from "@t3tools/shared/gitHubAccountRouting";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import type { PinnedGitHubCredentialValue } from "./GitHubCli.ts";

/** How long a cwd keeps mapping to the same project before the projection is read again. */
const PROJECT_INDEX_TTL = Duration.seconds(30);
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX_ENTRIES = 32;
const PROJECT_INDEX_KEY = "projects";

export interface GitHubAccountSelection {
  readonly host: string;
  readonly login: string;
}

export interface GitHubAccountCheckout {
  readonly cwd: string;
  readonly projectId?: ProjectId | undefined;
}

/**
 * Which `gh` account a checkout should use. Precedence: the project's own override, then the
 * first environment rule whose host and owner pattern match, then null for gh's active account,
 * which is exactly what every call did before account selection existed.
 */
export class GitHubAccountSelector extends Context.Service<
  GitHubAccountSelector,
  {
    readonly forCheckout: (
      input: GitHubAccountCheckout,
    ) => Effect.Effect<GitHubAccountSelection | null>;
    /** The selected account's token as a checkout-scoped pin, or null when nothing is selected. */
    readonly pinFor: (
      input: GitHubAccountCheckout,
    ) => Effect.Effect<PinnedGitHubCredentialValue | null>;
    /** Forget a cached token so the next pin asks `gh` again, for example after an auth failure. */
    readonly invalidate: (selection: GitHubAccountSelection) => Effect.Effect<void>;
  }
>()("t3/sourceControl/GitHubAccountSelector") {}

const tokenKey = (selection: GitHubAccountSelection) =>
  `${selection.host.toLowerCase()}\0${selection.login}`;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const identities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const sql = yield* SqlClient.SqlClient;
  const process = yield* VcsProcess.VcsProcess;

  // Every project root and thread worktree the projection knows, so a cwd with no project id
  // can still find its override. Read the projection tables directly rather than the shell
  // snapshot query: that query resolves identities through the source control registry, which
  // is what this selector is a dependency of. One read serves every checkout for the TTL.
  const projectIndex = yield* Cache.makeWith(
    (_key: string) =>
      Effect.gen(function* () {
        const worktrees = yield* sql<{ readonly root: string; readonly projectId: ProjectId }>`
          SELECT worktree_path AS "root", project_id AS "projectId"
          FROM projection_threads
          WHERE worktree_path IS NOT NULL
            AND project_id IN (SELECT project_id FROM projection_projects)
        `;
        const roots = yield* sql<{ readonly root: string; readonly projectId: ProjectId }>`
          SELECT workspace_root AS "root", project_id AS "projectId"
          FROM projection_projects
        `;
        const byRoot = new Map<string, ProjectId>();
        // Project roots win over worktrees that happen to share a path.
        for (const row of [...worktrees, ...roots]) byRoot.set(row.root, row.projectId);
        return byRoot as ReadonlyMap<string, ProjectId>;
      }).pipe(Effect.orElseSucceed((): ReadonlyMap<string, ProjectId> => new Map())),
    {
      capacity: 1,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? PROJECT_INDEX_TTL : Duration.zero),
    },
  );

  const forCheckout: GitHubAccountSelector["Service"]["forCheckout"] = Effect.fn(
    "GitHubAccountSelector.forCheckout",
  )(function* (input) {
    const identity = yield* identities.resolve(input.cwd);
    if (identity === null || identity.provider !== "github" || identity.owner === undefined) {
      return null;
    }
    const settings = yield* serverSettings.getSettings.pipe(Effect.option);
    if (settings._tag === "None") return null;
    const host = pullRequestHostOf(identity, "github");
    const projectId =
      input.projectId ??
      (yield* Cache.get(projectIndex, PROJECT_INDEX_KEY).pipe(
        Effect.map((index) =>
          identity.rootPath === undefined ? null : (index.get(identity.rootPath) ?? null),
        ),
      ));
    const projectOverride =
      projectId === null
        ? undefined
        : resolveProjectSettings(settings.value, projectId).overrides.gitHubAccount;
    const login = resolveGitHubAccount({
      rules: settings.value.gitHubAccountRules,
      projectOverride,
      host,
      owner: identity.owner,
    });
    return login === null ? null : { host, login };
  });

  const tokenCache = new Map<
    string,
    { readonly at: number; readonly credential: PinnedGitHubCredentialValue }
  >();
  const missingTokenLogged = new Set<string>();

  const pinFor: GitHubAccountSelector["Service"]["pinFor"] = Effect.fn(
    "GitHubAccountSelector.pinFor",
  )(function* (input) {
    const selected = yield* forCheckout(input);
    if (selected === null) return null;
    const key = tokenKey(selected);
    const now = yield* Clock.currentTimeMillis;
    const cached = tokenCache.get(key);
    if (cached !== undefined && now - cached.at < TOKEN_CACHE_TTL_MS) return cached.credential;
    // Only the digest of the token is ever retained outside the redacted value.
    const output = yield* process
      .run({
        operation: "GitHubAccountSelector.token",
        command: "gh",
        args: ["auth", "token", "--hostname", selected.host, "--user", selected.login],
        cwd: input.cwd,
        env: { GH_DEBUG: "" },
      })
      .pipe(Effect.option);
    const token =
      output._tag === "Some" && output.value.exitCode === 0 ? output.value.stdout.trim() : "";
    if (token.length === 0) {
      if (!missingTokenLogged.has(key)) {
        missingTokenLogged.add(key);
        yield* Effect.logDebug("GitHub account has no token", {
          host: selected.host,
          login: selected.login,
        });
      }
      return null;
    }
    missingTokenLogged.delete(key);
    const credential: PinnedGitHubCredentialValue = {
      host: selected.host,
      token: Redacted.make(token),
      credentialFingerprint: `${selected.host}:${selected.login}:${NodeCrypto.createHash("sha256").update(token).digest("hex")}`,
      scope: "checkout",
    };
    if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
      tokenCache.delete(tokenCache.keys().next().value!);
    }
    tokenCache.set(key, { at: now, credential });
    return credential;
  });

  const invalidate: GitHubAccountSelector["Service"]["invalidate"] = (selection) =>
    Effect.sync(() => {
      tokenCache.delete(tokenKey(selection));
    });

  return GitHubAccountSelector.of({ forCheckout, pinFor, invalidate });
});

const layer = Layer.effect(GitHubAccountSelector, make);

/**
 * The selector with its own process, identity, and projection dependencies. Settings and the
 * SQL client come from the runtime that hosts it. It reads remotes through the plain identity
 * resolver rather than the server's refined one, which depends on the source control registry
 * that this selector is itself a dependency of.
 */
export const layerLive = layer.pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(VcsProcess.layer),
);

/** No account selection at all: every call keeps gh's active account. For contexts without settings. */
export const layerUnselected = Layer.succeed(
  GitHubAccountSelector,
  GitHubAccountSelector.of({
    forCheckout: () => Effect.succeed(null),
    pinFor: () => Effect.succeed(null),
    invalidate: () => Effect.void,
  }),
);
