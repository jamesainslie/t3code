/**
 * Fork-only. The taxonomy that decides what happens to every `t3` (any case)
 * in the fork's tracked files when the fork renames itself to Lathe. Each
 * occurrence goes to the first rule that matches it; an occurrence no rule
 * matches is unclassified, and the rename refuses to run until a rule covers
 * it. New upstream code therefore stops a sync until someone decides what its
 * names mean, instead of the codemod guessing.
 *
 * The classes, and what the rename does with each:
 *   identifier          renamed mechanically; never leaves the build
 *   display             text a person reads; substituted from the identity values
 *   agent-facing        names agents see (MCP server and tools, prompt tags); renamed
 *   persisted           stored by the fork; write the Lathe name, read both, warn
 *   kept                renaming would strand stored data or something the fork does not control; kept byte-identical
 *   wire-peer           exchanged with services and clients the fork does not run; kept byte-identical
 *   upstream-reference  credit or links to upstream; kept
 *   false-positive      not a reference at all (uint32, encoded data); ignored
 */

export const RENAME_CLASSES = [
  "identifier",
  "display",
  "agent-facing",
  "persisted",
  "kept",
  "wire-peer",
  "upstream-reference",
  "false-positive",
] as const;
export type RenameClass = (typeof RENAME_CLASSES)[number];

export const RENAME_CLASS_ACTIONS: Readonly<Record<RenameClass, string>> = {
  identifier: "Renamed mechanically",
  display: "Substituted from the identity values",
  "agent-facing": "Renamed; old names stay recognised in stored tool calls",
  persisted: "Writes the Lathe name, reads both, warns on the old one",
  kept: "Kept byte-identical",
  "wire-peer": "Kept byte-identical",
  "upstream-reference": "Kept",
  "false-positive": "Ignored",
};

/** One `t3` hit in a tracked file. */
export interface RenameOccurrence {
  /** Repo-relative POSIX path. */
  readonly path: string;
  /** The identifier-ish run of characters around the hit. */
  readonly token: string;
  /** Offset of the hit inside `token`. */
  readonly offset: number;
  /** The full line holding the hit. */
  readonly line: string;
}

export interface RenameRule {
  readonly id: string;
  readonly class: RenameClass;
  readonly reason: string;
  /** Tested against the token. */
  readonly token?: RegExp;
  /** Tested against the line. */
  readonly line?: RegExp;
  /** Tested against the path. */
  readonly path?: RegExp;
  /** Tested against the occurrence, for rules a pattern cannot express. */
  readonly test?: (occurrence: RenameOccurrence) => boolean;
}

/** The characters that make up a token: identifiers, paths, URLs, package specifiers. */
export const RENAME_TOKEN_PATTERN = /[A-Za-z0-9_$@.:/\\-]*[tT]3[A-Za-z0-9_$@.:/\\-]*/g;

/** Every `t3` hit in `text`, as occurrences. */
export const findRenameOccurrences = (path: string, text: string): Array<RenameOccurrence> => {
  const occurrences: Array<RenameOccurrence> = [];
  const lines = text.split("\n");
  for (const line of lines) {
    for (const match of line.matchAll(RENAME_TOKEN_PATTERN)) {
      const token = match[0];
      for (let at = token.search(/t3/i); at !== -1;) {
        occurrences.push({ path, token, offset: at, line });
        const next = token.slice(at + 2).search(/t3/i);
        at = next === -1 ? -1 : at + 2 + next;
      }
    }
  }
  return occurrences;
};

const matches = (rule: RenameRule, occurrence: RenameOccurrence) =>
  (rule.path === undefined || rule.path.test(occurrence.path)) &&
  (rule.token === undefined || rule.token.test(occurrence.token)) &&
  (rule.line === undefined || rule.line.test(occurrence.line)) &&
  (rule.test === undefined || rule.test(occurrence));

/** The first rule that covers `occurrence`, or undefined when none does. */
export const classifyRenameOccurrence = (
  rules: ReadonlyArray<RenameRule>,
  occurrence: RenameOccurrence,
): RenameRule | undefined => rules.find((rule) => matches(rule, occurrence));

/** The character right before the hit inside its token, or "" at the token start. */
const before = (occurrence: RenameOccurrence) =>
  occurrence.token.slice(Math.max(0, occurrence.offset - 1), occurrence.offset);

/** True when the hit sits inside an escape such as `\nt3`, where the `n` is not a letter. */
const afterEscape = (occurrence: RenameOccurrence) =>
  /\\[nrt]$/.test(occurrence.token.slice(0, occurrence.offset));

/** The token's word-part that holds the hit: its run of letters and digits. */
const stem = (occurrence: RenameOccurrence) => {
  const lead = occurrence.token.slice(0, occurrence.offset).replace(/^.*\\[nrt]/, "");
  const head = lead.match(/[A-Za-z0-9]*$/)?.[0] ?? "";
  const tail = occurrence.token.slice(occurrence.offset).match(/^[A-Za-z0-9]*/)?.[0] ?? "";
  return head + tail;
};

export const FORK_RENAME_RULES: ReadonlyArray<RenameRule> = [
  // false positives: a "t3" that is part of another word or of encoded data
  {
    id: "fp-inside-word",
    class: "false-positive",
    reason: "Lowercase t3 inside a word or number: uint32, project3, Object3D.",
    test: (o) => o.token[o.offset] === "t" && /[A-Za-z0-9]/.test(before(o)) && !afterEscape(o),
  },
  {
    id: "fp-uppercase-word",
    class: "false-positive",
    reason: "Uppercase T3 inside a word and followed by a digit: VT320, INT32.",
    test: (o) =>
      o.token[o.offset] === "T" &&
      /[A-Z]/.test(before(o)) &&
      /\d/.test(o.token[o.offset + 2] ?? ""),
  },
  {
    id: "kept-rename-rules",
    class: "kept",
    reason: "The rename's own rules and report, which must keep naming the old forms.",
    path: /^scripts\/(?:lib\/forkRenameRules(?:\.test)?\.ts|fork-rename-report\.ts)$/,
  },
  {
    id: "fp-encoded-data",
    class: "false-positive",
    reason: "Base64 or hashed data: embedded images, lockfile integrity, signatures.",
    test: (o) =>
      /base64,|integrity|sha(?:256|512)-/.test(o.line) || /^[A-Za-z0-9+/=]{40,}$/.test(stem(o)),
  },

  // wire-peer: exchanged with services and clients the fork does not run.
  // Lathe builds use upstream's T3 Connect (relay.t3.codes, clerk.t3.codes,
  // app.t3.codes), and upstream's hosted app and mobile app can talk to a
  // Lathe server, so these stay byte-identical (jamesainslie/t3code#71).
  {
    id: "wire-upstream-relay-source",
    class: "wire-peer",
    reason:
      "infra/relay is upstream's relay source; the fork never deploys it, and it shares the protocol with the server.",
    path: /^infra\/relay\//,
  },
  {
    id: "wire-relay-protocol",
    class: "wire-peer",
    reason:
      "Relay protocol: JWT types and issuers, headers, routes, client ids and literals the relay checks.",
    token:
      /t3-env:|t3-(?:env|cloud|relay)-[a-z-]+\+jwt|x-t3-(?:relay|hook)-|\/api\/t3-connect\b|t3MintCredential|^["'`]?t3-(?:web|mobile)["'`]?[,;)]?$|^["'`]?t3_relay["'`]?|t3-code-relay|^["'`]?t3-relay["'`]?,?$/,
  },
  {
    id: "wire-relay-type-names",
    class: "wire-peer",
    reason: "Relay JWT type names declared in the shared relay constants.",
    path: /relayJwt\.ts$/,
    token: /t3-(?:env|cloud|relay)-[a-z-]+/,
  },
  {
    id: "wire-upstream-hosts",
    class: "wire-peer",
    reason: "Upstream's Connect hosts and Clerk instance, used as-is.",
    token: /(?:^|[^a-z])(?:relay|clerk|app|nightly\.app|preview)\.t3\.codes|Y2xlcmsudDMuY29kZXMk/,
  },
  {
    id: "wire-client-protocol",
    class: "wire-peer",
    reason:
      "Server surface upstream clients speak: discovery, the protocol header, the bootstrap token type, telemetry shapes.",
    token:
      /\/\.well-known\/t3\b|x-t3-orchestration-protocol|urn:t3:params|^["'`]?allT3["'`:]?|unknown-t3|^["'`]?t3_kind["'`]?/,
  },
  {
    id: "wire-telemetry-names",
    class: "wire-peer",
    reason:
      "Names in telemetry sent to upstream's PostHog and relay trace datasets (off by default).",
    test: (o) =>
      /^t3CodeVersion$|t3\.client\.|^["'`]?t3code-(?:server|desktop|web)["'`]?,?$|service\.namespace/.test(
        o.token,
      ) || /service\.namespace|service\.runtime|serviceName:/.test(o.line),
  },

  {
    id: "wire-credential-owner",
    class: "wire-peer",
    reason: 'The credentialOwner literal "t3" in provider auth state that upstream clients decode.',
    path: /ProviderCredentialStore\.ts$|contracts\/src\/providerSetup\.ts$/,
    test: (o) => o.token === "t3" && /["'`]t3["'`]/.test(o.line),
  },
  {
    id: "wire-vendor-identities",
    class: "wire-peer",
    reason:
      "Client identities provider vendors see (OpenAI, xAI, ACP agents, Muse); the fork reports as upstream.",
    test: (o) =>
      (/CODEX_CLIENT_NAME|agent_name_hint|OAUTH2?_REFERRER|clientInfo|createdByClient|clientName/.test(
        o.line,
      ) &&
        /^(?:T3|t3_code|t3-code|t3code|T3_CODE_OAUTH_REFERRER)$/.test(
          stem(o) === "T3" ? "T3" : o.token.replace(/^["'`]|["'`,;:)}]+$/g, ""),
        ) &&
        !o.path.endsWith(".ndjson")) ||
      /^["'`]?t3-code-(?:text|provider-setup|acp-cli|provider-auth|provider-test|session-manager|provider-probe|git-text)["'`]?/.test(
        o.token,
      ),
  },

  // kept: renaming would strand stored data or something the fork does not control
  {
    id: "kept-synced-thread-ids",
    class: "kept",
    reason:
      "t3sync- thread and t3syncasset- ids are matched by prefix in SQL and the sync planner; renaming duplicates every synced thread.",
    token: /t3sync(?:asset)?-?/,
  },
  {
    id: "kept-capture-data-dir",
    class: "kept",
    reason:
      "The t3code segment of the Linux capture helpers' data directory, which an upstream install also writes; and the WSL tree marker legacy cleanup still reads.",
    test: (o) =>
      (/dataHome|extension-backups|capture/.test(o.line) && o.token === "t3code") ||
      /t3code-wsl-server-tree\.json/.test(o.token),
  },
  {
    id: "kept-cross-version-env",
    class: "kept",
    reason:
      "Variables a pinned service launcher passes to newer and older servers, and that installed unit files hold.",
    token: /T3_SERVICE_LAUNCHER_CONTEXT|T3_BOOT_SERVICE_UNIT/,
  },
  {
    id: "kept-os-registrations",
    class: "kept",
    reason:
      "Bundle id, boot service units and Apple records the fork already keeps on purpose: a new id is a new app to the OS.",
    token: /us\.ainslies\.t3code|com\.t3tools\.t3code\.service|t3code-fork\.service/,
  },
  {
    id: "kept-project-file",
    class: "kept",
    reason:
      "t3.json and .t3code/vcs.json live in users' repos, shared with upstream users; the schema is hosted on t3.codes.",
    token: /(?:^|[^A-Za-z])t3\.json|t3\.codes\/schema|\.t3code\/vcs\.json|T3_PROJECT_FILE_NAME/,
  },
  {
    id: "kept-checkpoint-refs",
    class: "kept",
    reason:
      "refs/t3/ checkpoint refs in users' repos, shared with upstream installs; the previous ref is recomputed from the prefix.",
    token: /refs\/t3\//,
  },
  {
    id: "kept-linux-capture-helpers",
    class: "kept",
    reason:
      "SnapShot helpers, desktop file, GNOME extension and portal shortcut ids that an upstream install on the same machine also writes.",
    token:
      /\/com\/t3tools\/|share\/t3code|t3code\/(?:kde|hyprland)-capture|extension-backups|com\.t3tools\.(?:T3Code\.(?:Development\.)?SnapShot|T3Code\.KdeCapture|KdeCapture|SnapShot|T3Code\.SnapShot|T3Code:capture)|X-T3Code-Capture-Helper|snap-shot@t3\.codes|T3SnapShot|t3-snap-shot-|t3-(?:kde|hyprland)-snap-shot/,
  },
  {
    id: "kept-upstream-home",
    class: "kept",
    reason: "~/.t3 as upstream's install, read by project sync and the dev-data scripts.",
    test: (o) =>
      /(?:^|[/~"'`])\.t3(?:$|[/"'`])/.test(o.token) &&
      /projectSync|migrate-dev-db|t3-sqlite-state|upstream/i.test(o.path + o.line),
  },
  {
    id: "kept-mobile-sandbox",
    class: "kept",
    reason:
      "Mobile storage, schemes and bundle ids: the app keeps upstream's bundle ids, so these live in upstream's sandbox until the fork ships its own app.",
    path: /^apps\/mobile\//,
    token:
      /^["'`]?t3code\.|t3code-client\.db|t3-composer-|t3-attachment|t3-favicon-thumbnail|t3-agent-notifications|com\.t3tools\.t3code|^["'`]?t3code(?:-dev|-preview)?:?\/\/|^["'`]?t3code(?:-dev|-preview)["'`]?/,
  },

  // persisted: stored by the fork; write the Lathe name, read both, warn
  {
    id: "persisted-link-schemes",
    class: "persisted",
    reason:
      "Citation, thread and context links stored in message text; upstream clients send the t3 forms too.",
    token: /t3-(?:citation|thread|context):|^["'`]?t3-(?:citation|thread|context)["'`]?,?$/,
  },
  {
    id: "persisted-renderer-storage",
    class: "persisted",
    reason:
      "Renderer localStorage and IndexedDB keys holding user data and preferences; the desktop import copies them by name.",
    test: (o) =>
      /^["'`]?(?:t3code[:.][a-z]|t3[:.](?:pullRequests\.preferences|backgroundActivity|chatgpt))/.test(
        o.token.slice(Math.max(0, o.offset - 1)),
      ) &&
      !/t3code:(?:open-command-palette|preview-action|focus-composer|local_storage_change|github-routing-changed|update-everything-result|snap-shot-setup-resume|chunk-load-reloaded|dev-compression|project-favicons)|t3\.pullRequests\.(?:detail|list)/.test(
        o.token,
      ),
  },
  {
    id: "persisted-connection-profile",
    class: "persisted",
    reason: 'The "t3-connect" authorization literal stored in saved connection catalogs.',
    path: /client-runtime\/src\/connection\//,
    token: /^t3-connect$/,
  },
  {
    id: "persisted-theme-ids",
    class: "persisted",
    reason:
      "Built-in theme ids stored as the selected theme (and sent to clients as the environment theme).",
    test: (o) =>
      /^["'`]?t3-(?:chat|grove|ocean|ember|iris)(?:-(?:dark|light))?["'`]?[,;:)]?$|T3_CHAT_THEME|LEGACY_T3_CHAT/.test(
        o.token,
      ) ||
      (/[Tt]heme/.test(o.path) && /^t3-[a-z]+(?:-(?:dark|light))?$/.test(o.token)),
  },
  {
    id: "persisted-session-cookie",
    class: "persisted",
    reason: "The t3_session cookie; the server already reads one legacy name.",
    token: /(?:^|[^a-z])t3_session(?!.*dev)/,
  },
  {
    id: "persisted-cross-version-ipc",
    class: "persisted",
    reason:
      "Names two different versions must agree on: the desktop control socket, bootstrap token label, clipboard MIME.",
    token: /t3code-app-|t3-desktop-bootstrap|x-t3-context-fragment/,
  },
  {
    id: "persisted-desktop-state",
    class: "persisted",
    reason:
      "Desktop and host state read back across runs: preview browser partitions, the AppArmor profile, WSL runtime markers.",
    token: /persist:t3code-preview|t3code-preview-|t3-chrome-headless-shell|\.t3code-wsl-runtime-/,
  },
  {
    id: "persisted-pr-branches",
    class: "persisted",
    reason: "t3code/pr-<n>/ checkout branches read back when a worktree is reused.",
    token: /t3code\/pr-|t3code-pr-/,
  },
  {
    id: "persisted-legacy-fork-names",
    class: "persisted",
    reason:
      "Pre-Lathe fork names the fork already reads as legacy: .t3f, t3f, t3code-fork, t3code/<hex> branches, boot service units.",
    token:
      /\.t3f\b|^t3f$|t3f\.cmd|t3code-fork|app-t3code-fork|t3code[/-]<|^["'`]?t3code["'`]?,?$(?=)/,
    test: (o) =>
      !/^["'`]?t3code["'`]?,?$/.test(o.token) ||
      /legacy|LEGACY|worktreeBranchPrefix|systemdName/.test(o.line),
  },
  {
    id: "id-build-and-test-env",
    class: "identifier",
    reason:
      "T3CODE_* variables only the fork's own build, dev tooling and tests set, plus build-time markers.",
    test: (o) =>
      /^__T3CODE_|^T3CODE_(?:DESKTOP_(?:PLATFORM|TARGET|ARCH|VERSION|OUTPUT_DIR|SKIP_BUILD|KEEP_STAGE|SIGNED|VERBOSE|WSL_RUNTIME|UPDATE_REPOSITORY|REUSE_[A-Z_]+|MOCK_[A-Z_]+|APP_USER_MODEL_ID|PROTOCOL_REGISTRATION_MANAGED|REMOTE_DEBUGGING_PORT|WS_URL|LAN_ACCESS|DEV)|PACK_EXE[A-Z_]*|WEB_(?:SOURCEMAP|ROUTER_URL|LATEST_DOMAIN|NIGHTLY_DOMAIN)|BUNDLED_DEV|SINGLE_ORIGIN_DEV|DEV_ALLOWED_HOSTS|LICENSES_STRICT|CLI_MAC_SIGN_IDENTITY|RELAY_CLIENT_CONFIG_ENV|TRANSFER_BUDGET_[A-Z_]+|COMMIT_HASH|DEV_REMOTE_T3_SERVER_ENTRY_PATH|CURSOR_ENABLED|SECRET|SELECT_SCRIPT|INSTALL_SCRIPT|TEST_HEADLESS_SHELL|ENV_[A-Z_]+__)\b/.test(
        o.token.slice(o.offset - (o.token.slice(0, o.offset).endsWith("__") ? 2 : 0)),
      ),
  },
  {
    id: "persisted-exported-env",
    class: "persisted",
    reason:
      "T3CODE_PROJECT_ROOT and T3CODE_WORKTREE_PATH are set for users' project scripts: export both names, not read both.",
    token: /T3CODE_(?:PROJECT_ROOT|WORKTREE_PATH)/,
  },
  {
    id: "persisted-stored-output-key",
    class: "persisted",
    reason: "The t3McpApp key in stored tool output, matched by SQL LIKE and the output decoder.",
    token: /t3McpApp/,
  },
  {
    id: "persisted-provider-side-state",
    class: "persisted",
    reason:
      "Names other processes keep across upgrades: OpenCode's per-session instruction key, the ACP stale-cgroup prefix, the desktop control socket directory.",
    test: (o) =>
      (/opencode\/src\/server\/v2\//.test(o.path) && /INSTRUCTIONS_KEY/.test(o.line)) ||
      (/AcpSessionRuntime/.test(o.path) && /t3-acp-/.test(o.token)) ||
      (/desktopAppControl/.test(o.path) && /t3code-/.test(o.token)),
  },
  {
    id: "persisted-legacy-home-matchers",
    class: "persisted",
    reason:
      "Matchers that recognise worktrees under any of the home directory names (.t3, .lathe, .t3f).",
    line: /\(\?:t3\|lathe\|t3f\)/,
  },
  {
    id: "persisted-env",
    class: "persisted",
    reason:
      "T3CODE_* environment variables users, unit files, shell profiles and docs set. LATHE_* becomes the name; T3CODE_* stays an alias that is read with a warning. Installed boot units hold T3CODE_HOME, so the unit parser and its staleness check must accept both too.",
    test: (o) =>
      /^(?:VITE_)?T3CODE_[A-Z0-9_]*/.test(
        o.token.slice(
          Math.max(0, o.offset - (o.token.slice(0, o.offset).endsWith("VITE_") ? 5 : 0)),
        ),
      ),
  },
  {
    id: "persisted-html-render-bootstrap",
    class: "persisted",
    reason:
      "Names baked into stored html_render pages: the t3-theme fragment and style, t3/notifications methods, t3-link ids.",
    token: /t3-theme|t3\/notifications|t3-link-/,
  },

  // upstream references: credit, links, and upstream's own published names
  {
    id: "upstream-repo",
    class: "upstream-reference",
    reason: "Links to upstream's repository, issues and pull requests.",
    token: /(?:pingdotgg|t3dotgg|T3Tools|t3tools)\/t3code|github\.com\/pingdotgg|t3dotgg\b/i,
  },

  {
    id: "upstream-org-and-products",
    class: "upstream-reference",
    reason: "Upstream's company and sister products, and their published ids.",
    test: (o) =>
      /T3 (?:Tools|Chat)\b|t3tools\.com|T3Tools\.T3Code/.test(o.line) &&
      /^(?:T3|t3tools|T3Tools|T3Code)$/.test(stem(o)) &&
      !/T3 Code/.test(o.line.slice(Math.max(0, o.line.indexOf(o.token) - 1))),
  },

  // agent-facing: names agents see and address
  {
    id: "agent-mcp-names",
    class: "agent-facing",
    reason:
      "MCP server name (t3-code) and tool names (t3_*) agents call. Renamed to lathe and lathe_*; the old names stay recognised permanently, since stored tool calls and provider transcripts hold them.",
    token:
      /mcp__t3[-_]code__|(?:^|[^A-Za-z0-9])t3_(?:workflow|thread|preview|worktree|device|project|environment|pending|queue|attachment|html|orchestrator|scheduled|delegate|task|document|link|unwatch|watch|find|read|create|list|request|resolve)[a-z_]*|^["'`]?t3-code["'`:]?$|^t3-code-\*/,
  },
  {
    id: "agent-mcp-matchers",
    class: "agent-facing",
    reason:
      "Matchers that recognise the MCP server under its spellings (t3-code, t3_code, t3code) in stored tool names.",
    line: /t3\[-_ \]\?code|t3-code MCP|\(t3\[-_ ]|t3-code\|t3_code\|t3code|T3_MCP_SERVER_ALIASES/,
  },
  {
    id: "agent-mcp-spellings",
    class: "agent-facing",
    reason:
      "The MCP server name in tool ids, matchers and setup commands (t3-code.x, _t3-code, claude mcp add ... t3), and ACP extension methods (_t3/...).",
    test: (o) =>
      /t3-code[./\\$-]|_t3-code|t3-code\/|^_t3\//.test(o.token) ||
      (/mcp add/.test(o.line) && /^t3$/.test(o.token)),
  },
  {
    id: "agent-prompt-tags",
    class: "agent-facing",
    reason: "Prompt markup agents read (<t3_context>, t3_code_instructions).",
    token: /t3_context|t3_code_[a-z_]+|(?:^|[^A-Za-z])t3_code(?:$|[^a-z_])/,
  },

  // identifiers: names that never leave the build
  {
    id: "id-css-names",
    class: "identifier",
    reason: "CSS classes and custom properties (font-t3-*, --t3-*).",
    token:
      /(?:^|[^A-Za-z])font-t3-|--t3-|t3-file-icon-|t3-(?:assistant-citation|thread-find|document-comment)/,
  },
  {
    id: "id-native-modules",
    class: "identifier",
    reason:
      "Mobile native module packages and directories built with the app (t3-terminal, expo.modules.t3*).",
    token:
      /expo\.modules\.t3|modules\/t3-|(?:^|[^A-Za-z])t3-(?:terminal|native-controls|source-text|review-diff|composer-editor|widget-expiry|agent-notifications|markdown-text)\b|^t3(?:terminal|nativecontrols|sourcetext|reviewdiff|composereditor|widgetexpiry|agentnotifications)$/,
  },
  {
    id: "id-lint-plugin",
    class: "identifier",
    reason: "The repo's oxlint plugin and rule names (t3code/no-*).",
    token: /^t3code\/[a-z-]+$/,
  },
  {
    id: "id-internal-env",
    class: "identifier",
    reason: "T3_* variables our own processes pass to each other or to tests, never set by a user.",
    test: (o) => /^T3_[A-Z0-9_]/.test(o.token.slice(o.offset)) && !/[A-Za-z0-9]/.test(before(o)),
  },
  {
    id: "id-package-scope",
    class: "identifier",
    reason: "Workspace package scope; every package is workspace-local (renamed to @lathe/).",
    test: (o) => /^@t3tools(?:\/|$)/.test(o.token.slice(Math.max(0, o.offset - 1))),
  },
  {
    id: "id-camel-symbol",
    class: "identifier",
    reason: "camelCase or PascalCase code symbol (T3ComposerEditorView, allT3, t3Home).",
    test: (o) => /[a-z]T3|T3[A-Z][a-z]|^t3[A-Z][a-z]|[A-Z]T3[A-Z][a-z]/.test(stem(o)),
  },

  // display: text a person reads
  {
    id: "display-product-name",
    class: "display",
    reason: 'The product name "T3 Code" in UI strings, docs and comments.',
    test: (o) => o.token.slice(o.offset) === "T3" && / ?T3 Code\b/.test(o.line),
  },
  {
    id: "display-short-name",
    class: "display",
    reason: 'The short product name in prose: "T3 thread", "T3 home", "T3-owned".',
    test: (o) =>
      /^T3(?:-(?:owned|managed|Code|code))?[.,:;)'"]*$/.test(o.token) &&
      !/T3 (?:Connect|Tools|Chat)\b/.test(o.line),
  },

  // area defaults: whole areas whose remaining names share one answer
  {
    id: "kept-repo-slug",
    class: "kept",
    reason:
      "The GitHub repo slug jamesainslie/t3code: installed desktops, the CLI updater and npm publishing are bound to it.",
    token: /jamesainslie\/t3code/,
  },
  {
    id: "wire-relay-package",
    class: "wire-peer",
    reason: "The relay workspace package (t3code-relay), part of upstream's relay source.",
    token: /^["'`]?(?:--filter[= ])?t3code-relay\b/,
  },
  {
    id: "upstream-linux-metainfo",
    class: "upstream-reference",
    reason: "Upstream's AppStream metainfo, which the fork does not ship.",
    path: /metainfo\.xml$/,
  },
  {
    id: "id-temp-and-ci-names",
    class: "identifier",
    reason:
      "Temp directory prefixes, CI temp files and keychains, dev-container volumes, and comment markers; nothing reads them across versions.",
    test: (o) =>
      /^["'`(]?t3(?:code)?-[a-z0-9-]*-["'`]?\)?,?$|t3(?:code)?-[a-z0-9-]+-\$\{|t3code-(?:pnpm-store|node-modules|transfer-budget|android-|marketing)|t3-cli-signing|t3code\.provisionprofile|<!-- t3-/.test(
        o.token,
      ) ||
      (o.path.startsWith(".github/") && !/com\.t3tools/.test(o.token)),
  },
  {
    id: "id-desktop-internals",
    class: "identifier",
    reason:
      "Desktop internals rebuilt with the app: dev flags, build keys, Windows shim locals and types, CDP ids, icon files, the compile cache.",
    token:
      /--t3code-dev-root|t3code(?:CommitHash|WebAuthn)|t3_(?:codepage|exit)|T3\.Env|t3-(?:kernel32|user32|preview|black-windows|electron)|^["'`]t3code["'`],?$/,
    path: /^apps\/desktop\/|^scripts\/|\.vscode\//,
  },
  {
    id: "id-compile-cache",
    class: "identifier",
    reason:
      "The desktop compile cache directory, a throwaway cache (shared with upstream, so the old one is not deleted).",
    test: (o) => o.token === "t3code" && /compile-cache/.test(o.line),
  },
  {
    id: "persisted-cli-literal",
    class: "persisted",
    reason:
      "The executable name as a quoted literal in the files that install and run the CLI; forkCliArtifacts.ts keeps the t3 fallback.",
    path: /forkCliArtifacts|cliRelease|build-cli-archive|install\.(?:sh|ps1)|pinnedRuntime|selfUpdate|update\.ts|ForkCliInstall|tunnel\.ts|DesktopWsl|serviceLauncher|npm-launcher/,
    test: (o) => o.token === "t3" && /["'`]t3["'`]/.test(o.line),
  },
  {
    id: "id-transient-storage",
    class: "identifier",
    reason: "Storage keys and events that are transient or caches: renaming only clears them.",
    token:
      /t3code:(?:open-command-palette|preview-action|focus-composer|local_storage_change|github-routing-changed|update-everything-result|snap-shot-setup-resume|chunk-load-reloaded|dev-compression|project-favicons)|t3\.pullRequests\.(?:detail|list)|t3-acp-registry-icons|t3:(?:paste-as-text|thread-find-open)|t3-thread-context-drop|\.\{t3,lathe,t3f\}/,
  },
  {
    id: "id-effect-service-tags",
    class: "identifier",
    reason: "Effect service and context tag keys (t3/auth/SessionStore); in-process only.",
    test: (o) =>
      /^["'`]?t3\/[A-Za-z]/.test(o.token.slice(Math.max(0, o.offset - 1))) &&
      /\)\(\s*["'`]t3\/|Context\.|Service|Tag|^\s*["'`]t3\/[A-Za-z/]+["'`],?\s*$/.test(o.line),
  },
  {
    id: "id-shell-helpers",
    class: "identifier",
    reason:
      "Shell and script helper functions (t3_home, t3_write_pty, t3_runtime_ready) inside generated scripts.",
    token: /^t3_(?:home|write_pty|runtime_ready|fetch)$/,
  },
  {
    id: "id-metric-names",
    class: "identifier",
    reason:
      "OpenTelemetry metric names (t3_*_total); renaming them means updating any dashboard that queries them.",
    token: /^`?t3_[a-z_]+_(?:total|duration|wait|delay)`?$/,
  },
  {
    id: "id-runtime-ids-and-prefixes",
    class: "identifier",
    reason:
      "Runtime ids, temp and socket prefixes, log tags, MIME types, CSS transition names, asset files and test identities; nothing reads them across versions.",
    test: (o) =>
      /t3(?:code)?-\$|t3_\$|t3-(?:host|mermaid|term|orchestrator-v2|preview-clipboard|ghostty-input|permission-check|acp-cli|acp-mock|collab-mock|pi-mcp|markdown-inline-prefix|mobile-|draft-hero|snap-shot|agent|black-|iris|checkpoint-index|kde-bus|browser-launch|darwin)|t3code-(?:desktop|git-trace2|review-index|ssh-askpass|pierre)|\.t3-(?:capture|icon-export)|t3_capture_|t3ssh-|\/tmp\/t3-|x-t3code-|t3continue-|t3-xai-prompt-|msg_t3_|refs\/t3code\/|\.cache\/t3code\/|^t3\.export\.|^\[t3-|^t3:jsonrpc|\$t3:|t3code_no_provider|t3_dev_session_|noreply@t3\.codes|t3code@users\.noreply|t3code-test@|-t3\.\d+|dist-exe\/t3|npm-launcher\/t3\.mjs|release\/t3-|\/t3\.tgz|^\/t3\/$|\.\{t3,lathe,t3f\}|\\\.t3\b|t3\/[a-z0-9-]+\/[A-Z]|^\/?t3-connect$|^\[t3-|^["'`]t3\/orchestration-v2\/|t3-page\.localhost|t3-sqlite-state|not-a-t3-server|app-t3code-agents|^t3_write_pty/.test(
        o.token,
      ) ||
      (/^t3[.:]?$/.test(o.token) &&
        /otelEnvironment|provider-pi\/src\/server\/adapter|build-cli-archive/.test(o.path)) ||
      (/^["'`]?t3code["'`]?,?$/.test(o.token) &&
        /user-agent|DISPLAY|attribution|oxlint-plugin-t3code|name: "t3code"/.test(o.line)),
  },
  {
    id: "display-ui-placeholder",
    class: "display",
    reason: "UI placeholder text naming a t3 directory.",
    token: /\.codex-t3/,
  },
  {
    id: "id-oxlint-plugin-package",
    class: "identifier",
    reason: "The repo's oxlint plugin package name.",
    token: /oxlint-plugin-t3code/,
  },
  {
    id: "upstream-aur-packaging",
    class: "upstream-reference",
    reason:
      "packaging/aur is upstream's AUR package, published only by upstream's release workflow.",
    path: /^packaging\//,
  },
  {
    id: "persisted-cli-artifacts",
    class: "persisted",
    reason:
      "CLI release archive and executable names (t3-<version>-*, <runtime>/t3); forkCliArtifacts.ts publishes both names.",
    token:
      /^\(?t3-\*|t3-<version>|t3-\$\{version\}|\/t3`?\)?\.?$|^`?t3-\$|t3\.exe|^t3-(?:\.\.\.)?$|^t3;?$/,
    path: /forkCliArtifacts|cliRelease|build-cli-archive|build-desktop-artifact|install\.(?:sh|ps1)|pinnedRuntime|selfUpdate|update\.ts|ForkCliInstall|tunnel\.ts|DesktopWsl|fork-cli-release-assets|serviceLauncher|smoke-cli|npm-launcher/,
  },
  {
    id: "display-cli-version-spec",
    class: "display",
    reason:
      "The CLI shown as t3@<version> in status and update messages; the fork's package is @jamesainslie/lathe.",
    token: /(?:^|[^A-Za-z0-9])t3@/,
  },
  {
    id: "display-artifact-name",
    class: "display",
    reason:
      "Upstream's desktop artifact base name (T3-Code-<version>); the fork names artifacts after FORK_IDENTITY.artifactBaseName.",
    token: /T3-Code-/,
  },
  {
    id: "id-internal-literals",
    class: "identifier",
    reason:
      "In-process literals: Pi event types, the ACP unknown-update tag, settings search ids, placeholder hosts, the worktree .t3 dev directory.",
    test: (o) =>
      /^["'`]?t3\.[a-z_]+["'`]?,?$|_t3_unknown|t3\.invalid|pi-t3-mcp|t3-tree-/.test(o.token) ||
      (/(?:^|[/"'`$ ])\.t3(?:$|[/"'`])/.test(o.token) && !/\.mdx?$/.test(o.path)),
  },
  {
    id: "upstream-service-names",
    class: "upstream-reference",
    reason: "Upstream's services and accounts named in prose: T3 Connect, T3 account, T3 services.",
    test: (o) =>
      /^T3$/.test(stem(o)) && /T3 (?:Connect|account|services|Environment|App)\b/.test(o.line),
  },
  {
    id: "upstream-links-and-router",
    class: "upstream-reference",
    reason:
      "Links to upstream's site and legal pages, T3 Chat, upstream's web channel router, a vendored dependency's upstream branch, and upstream's own release workflow.",
    test: (o) =>
      /^https:\/\/t3\.(?:codes|chat)(?:\/[a-z-]+)?\/?$|t3code_web_channel|__t3code\/channel|tree\/t3code\//.test(
        o.token,
      ) || o.path === ".github/workflows/release.yml",
  },
  {
    id: "upstream-marketing-site",
    class: "upstream-reference",
    reason: "apps/marketing is upstream's site and legal pages; the fork does not deploy it.",
    path: /^apps\/marketing\//,
  },
  {
    id: "kept-mobile-app",
    class: "kept",
    reason: "The mobile app still ships upstream's identity; it gets its own rename project.",
    path: /^apps\/mobile\/|mobile|^\.github\/workflows\/mobile-|^\.agents\/skills\/test-t3-mobile\//,
    test: (o) => !/@t3tools/.test(o.token),
  },
  {
    id: "id-workspace-package-t3",
    class: "identifier",
    reason:
      "The server workspace package is named t3 (--filter t3, t3#build); renamed with the package.",
    line: /--filter[ =]['"]?!?t3\b|t3#[a-z]|"name": "t3"|filter=t3\.\.\./,
  },
  {
    id: "display-cli-command",
    class: "display",
    reason:
      "The CLI command in help text, errors and docs (`t3 serve`, `npx t3`); the fork's CLI is lathe.",
    test: (o) =>
      /^t3$/.test(stem(o)) &&
      /(?:^|[`'"( >])(?:npx |pnpm dlx |bunx )?t3(?: [a-z%][a-z-]*| --?[a-z]|`|'|"|\)|<|\\|$)/.test(
        o.line,
      ),
  },
  {
    id: "id-binaries-and-scripts",
    class: "identifier",
    reason:
      "Bundled helper binaries, shell functions, DOM data attributes and generated id prefixes built with the code.",
    token:
      /t3-resource-monitor|t3-browser-secret|t3_fetch|\$__t3c|data-t3code-|data-t3-context|t3_\$\{|run-t3|t3-runtime|\.notarize-t3|t3-cli-archive|t3-screens/,
  },
  {
    id: "kept-brand-layer-exceptions",
    class: "kept",
    reason:
      "The build-time brand layer's exception list, which names old forms on purpose until the layer is retired.",
    path: /^scripts\/lib\/forkBrand(?:\.test)?\.ts$/,
  },
  {
    id: "kept-vcs-config-file",
    class: "kept",
    reason: ".t3code/vcs.json read from users' repos, shared with upstream users.",
    test: (o) => o.token === ".t3code" && /vcs\.json/.test(o.line),
  },
  {
    id: "kept-dev-data-scripts",
    class: "kept",
    reason: "The dev-data scripts read upstream's ~/.t3 install.",
    path: /migrate-dev-db|t3-sqlite-state/,
    token: /^\.t3\.?$/,
  },
  {
    id: "id-small-internals",
    class: "identifier",
    reason:
      "Log tags, the derived message attribution, watcher globs, a replay checkout path and the repo's own skill names.",
    test: (o) =>
      /\[t3-cloud\]|\.\{t3,lathe,t3f\}|replay-user\/t3code|test-t3-(?:app|mobile)/.test(o.line) ||
      (o.token === "t3code" && o.path.endsWith("userMessage.ts")),
  },
  {
    id: "upstream-named-in-comments",
    class: "upstream-reference",
    reason: "Comments that name upstream's or pre-rename forms on purpose.",
    test: (o) =>
      /^\s*(?:\/\/|\*|\/\*\*?|#)/.test(o.line) &&
      /upstream|pre-rename|before the Lathe rename|legacy|V1 profiles/i.test(o.line),
  },
  {
    id: "id-comments",
    class: "identifier",
    reason: "Other comments; they follow the code they describe.",
    line: /^\s*(?:\/\/|\*|\/\*\*?|#)/,
  },
  {
    id: "display-docs-prose",
    class: "display",
    reason: "Remaining mentions in documentation and agent skill prose.",
    path: /\.mdx?$/,
  },

  // test fixtures: recorded transcripts, example paths and ids
  {
    id: "id-test-fixture",
    class: "identifier",
    reason:
      "Test data: replay transcripts, example paths, temp prefixes, ids. Follows the code it tests.",
    path: /(?:\.test\.[cm]?[jt]sx?|\.testkit\.ts|\/testkit\/|\/fixtures\/|__snapshots__\/.*|\.snap|\.ndjson)$|\/testkit\/|\/fixtures\//,
  },
];

export const ruleHelpers = { before, afterEscape, stem };
