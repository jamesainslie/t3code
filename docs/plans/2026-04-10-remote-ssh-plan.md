# Remote SSH Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add remote SSH capability to T3 Code so projects can run their server on a remote machine while keeping orchestration state local.

**Architecture:** The local client (Desktop or Web) manages the full SSH lifecycle — control socket multiplexing, binary provisioning, tmux session management, port forwarding, and reconnection. The remote T3 server speaks the same WebSocket RPC protocol as local. All orchestration state stays in the local SQLite database; the remote server is a stateless execution environment.

**Tech Stack:** Effect-TS (Services/Layers pattern), SSH subprocess via Node `child_process`, tmux (bundled static binary), WebSocket RPC (existing WsRpcGroup), Electron IPC (desktop), Zustand (web state), SQLite migration (persistence).

**Reference:** `docs/plans/2026-04-10-remote-ssh-design.md`

---

## Task 1: Contracts — RemoteHost schema and project model extension

**Files:**

- Modify: `packages/contracts/src/orchestration.ts`

**Step 1: Add `RemoteHost` schema before `OrchestrationProject`**

Find the `OrchestrationProject` definition (around line 140) and add above it:

```typescript
export const RemoteHost = Schema.Struct({
  host: TrimmedNonEmptyString,
  user: TrimmedNonEmptyString,
  port: Schema.optionalWith(PositiveInt, { default: () => 22 as PositiveInt }),
  label: Schema.optional(TrimmedString),
});
export type RemoteHost = typeof RemoteHost.Type;
```

**Step 2: Add `remoteHost` to `OrchestrationProject`**

```typescript
export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  remoteHost: Schema.optional(RemoteHost), // <-- add this
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
```

**Step 3: Add `remoteHost` to `ProjectCreatedPayload`**

Find `ProjectCreatedPayload` and add:

```typescript
remoteHost: Schema.optional(RemoteHost),
```

**Step 4: Add `remoteHost` to `ProjectCreateCommand`**

Find `ProjectCreateCommand` and add:

```typescript
remoteHost: Schema.optional(RemoteHost),
```

**Step 5: Build contracts to verify types compile**

```bash
bun run --cwd packages/contracts build
```

Expected: Build succeeds with no type errors.

**Step 6: Commit**

```bash
git add packages/contracts/src/orchestration.ts
git commit -m "feat(contracts): add RemoteHost schema and extend OrchestrationProject"
```

---

## Task 2: Contracts — Remote connection state types and log stream RPC

**Files:**

- Create: `packages/contracts/src/remoteConnection.ts`
- Modify: `packages/contracts/src/rpc.ts`
- Modify: `packages/contracts/src/index.ts`

**Step 1: Create `remoteConnection.ts`**

```typescript
import { Schema } from "effect";
import { ProjectId } from "./baseSchemas";

export const RemoteConnectionStatus = Schema.Literal(
  "disconnected",
  "provisioning",
  "starting",
  "connected",
  "reconnecting",
  "error",
);
export type RemoteConnectionStatus = typeof RemoteConnectionStatus.Type;

export const RemoteConnectionState = Schema.Struct({
  projectId: ProjectId,
  status: RemoteConnectionStatus,
  wsUrl: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  remoteVersion: Schema.optional(Schema.String),
  tunnelLocalPort: Schema.optional(Schema.Number),
});
export type RemoteConnectionState = typeof RemoteConnectionState.Type;

// Broker RPC — used by web app to talk to local t3 broker process
export const BrokerConnectInput = Schema.Struct({
  projectId: ProjectId,
  host: Schema.String,
  user: Schema.String,
  port: Schema.optionalWith(Schema.Number, { default: () => 22 }),
  workspaceRoot: Schema.String,
});
export type BrokerConnectInput = typeof BrokerConnectInput.Type;

export const BrokerConnectResult = Schema.Struct({
  wsUrl: Schema.String,
  authToken: Schema.String,
});
export type BrokerConnectResult = typeof BrokerConnectResult.Type;

export const BrokerDisconnectInput = Schema.Struct({
  projectId: ProjectId,
});

export const BrokerStatusResult = Schema.Struct({
  connections: Schema.Array(RemoteConnectionState),
});

export class BrokerError extends Schema.TaggedErrorClass<BrokerError>()("BrokerError", {
  message: Schema.String,
  phase: Schema.optional(Schema.String),
}) {}
```

**Step 2: Add `server.subscribeLogStream` to `rpc.ts`**

Add to `WS_METHODS`:

```typescript
serverSubscribeLogStream: "server.subscribeLogStream",
```

Add RPC definition:

```typescript
export const WsServerSubscribeLogStreamRpc = Rpc.make(WS_METHODS.serverSubscribeLogStream, {
  payload: Schema.Struct({}),
  success: Schema.Struct({
    level: Schema.String,
    message: Schema.String,
    timestamp: Schema.String,
  }),
  error: Schema.Never,
  stream: true,
});
```

Add to `WsRpcGroup.make(...)` call.

**Step 3: Export from `index.ts`**

```typescript
export * from "./remoteConnection";
```

**Step 4: Build and verify**

```bash
bun run --cwd packages/contracts build
```

Expected: No errors.

**Step 5: Commit**

```bash
git add packages/contracts/src/remoteConnection.ts packages/contracts/src/rpc.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add remote connection state types and log stream RPC"
```

---

## Task 3: Shared — SSH subprocess utilities

**Files:**

- Create: `packages/shared/src/ssh.ts`
- Create: `packages/shared/src/ssh.test.ts`
- Modify: `packages/shared/package.json` (add `./ssh` subpath export)

**Step 1: Write failing tests first**

Create `packages/shared/src/ssh.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseProbeOutput, buildSshArgs, buildPortForwardArgs, parseTmuxSessionList } from "./ssh";

describe("parseProbeOutput", () => {
  it("parses valid probe output", () => {
    const result = parseProbeOutput("OS:Linux ARCH:aarch64 VERSION:0.0.15");
    expect(result).toEqual({ os: "Linux", arch: "aarch64", currentVersion: "0.0.15" });
  });

  it("parses missing version as empty string", () => {
    const result = parseProbeOutput("OS:Darwin ARCH:x86_64 VERSION:");
    expect(result).toEqual({ os: "Darwin", arch: "x86_64", currentVersion: "" });
  });

  it("returns null for invalid output", () => {
    expect(parseProbeOutput("garbage")).toBeNull();
  });
});

describe("buildSshArgs", () => {
  it("builds base SSH args with control socket", () => {
    const args = buildSshArgs({ host: "devbox", user: "james", port: 22 });
    expect(args).toContain("-o");
    expect(args).toContain("ControlMaster=auto");
    expect(args).toContain("james@devbox");
  });

  it("includes custom port", () => {
    const args = buildSshArgs({ host: "devbox", user: "james", port: 2222 });
    expect(args).toContain("-p");
    expect(args).toContain("2222");
  });
});

describe("buildPortForwardArgs", () => {
  it("builds port forward args", () => {
    const args = buildPortForwardArgs({
      host: "devbox",
      user: "james",
      port: 22,
      localPort: 49200,
      remotePort: 38100,
    });
    expect(args).toContain("-L");
    expect(args).toContain("49200:127.0.0.1:38100");
  });
});

describe("parseTmuxSessionList", () => {
  it("parses tmux ls output", () => {
    const output = "t3-abc123: 1 windows\nt3-def456: 1 windows";
    const sessions = parseTmuxSessionList(output);
    expect(sessions).toEqual(["t3-abc123", "t3-def456"]);
  });

  it("returns empty array for empty output", () => {
    expect(parseTmuxSessionList("")).toEqual([]);
  });
});
```

**Step 2: Run to verify failures**

```bash
bun run test packages/shared/src/ssh.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create `packages/shared/src/ssh.ts`**

```typescript
/**
 * SSH utilities for remote server management.
 *
 * Provides pure helper functions for building SSH arguments, parsing
 * probe output, and managing remote state. Actual subprocess execution
 * is done by callers (desktop main process or broker) using Node child_process.
 *
 * @module ssh
 */
import * as OS from "node:os";
import * as Path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────

export interface SshTarget {
  host: string;
  user: string;
  port: number;
}

export interface ProbeResult {
  os: string;
  arch: string;
  currentVersion: string;
}

export interface PortForwardSpec extends SshTarget {
  localPort: number;
  remotePort: number;
}

// ── Control socket path ───────────────────────────────────────────────

export function controlSocketPath(target: SshTarget): string {
  const socketDir = Path.join(OS.homedir(), ".ssh", "sockets");
  return Path.join(socketDir, `${target.user}@${target.host}-${target.port}`);
}

// ── Argument builders ─────────────────────────────────────────────────

const BASE_SSH_OPTIONS = [
  "-o",
  "BatchMode=yes", // fail immediately on auth prompts
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ControlMaster=auto",
  "-o",
  `ControlPersist=4h`,
] as const;

export function buildSshArgs(target: SshTarget, extraArgs: string[] = []): string[] {
  const controlPath = controlSocketPath(target);
  const args: string[] = [...BASE_SSH_OPTIONS, "-o", `ControlPath=${controlPath}`];
  if (target.port !== 22) {
    args.push("-p", String(target.port));
  }
  args.push(...extraArgs);
  args.push(`${target.user}@${target.host}`);
  return args;
}

export function buildCheckSocketArgs(target: SshTarget): string[] {
  const controlPath = controlSocketPath(target);
  return ["-o", `ControlPath=${controlPath}`, "-O", "check", `${target.user}@${target.host}`];
}

export function buildPortForwardArgs(spec: PortForwardSpec): string[] {
  return buildSshArgs(spec, [
    "-O",
    "forward",
    "-L",
    `${spec.localPort}:127.0.0.1:${spec.remotePort}`,
    "-N",
  ]);
}

export function buildCancelForwardArgs(spec: PortForwardSpec): string[] {
  return buildSshArgs(spec, [
    "-O",
    "cancel",
    "-L",
    `${spec.localPort}:127.0.0.1:${spec.remotePort}`,
  ]);
}

// ── Remote probe script ───────────────────────────────────────────────

export const PROBE_SCRIPT = `#!/bin/sh
T3_HOME="$HOME/.t3"
mkdir -p "$T3_HOME/bin" "$T3_HOME/run" "$T3_HOME/logs"
CURRENT_VERSION=""
if [ -x "$T3_HOME/bin/t3" ]; then
  CURRENT_VERSION=$("$T3_HOME/bin/t3" --version 2>/dev/null || echo "")
fi
echo "OS:$(uname -s) ARCH:$(uname -m) VERSION:$CURRENT_VERSION"
`;

export function parseProbeOutput(output: string): ProbeResult | null {
  const match = output.trim().match(/^OS:(\S+)\s+ARCH:(\S+)\s+VERSION:(\S*)$/);
  if (!match) return null;
  return {
    os: match[1]!,
    arch: match[2]!,
    currentVersion: match[3]!,
  };
}

// ── Platform/arch mapping ─────────────────────────────────────────────

const OS_MAP: Record<string, string> = {
  Linux: "linux",
  Darwin: "darwin",
};

const ARCH_MAP: Record<string, string> = {
  x86_64: "x64",
  aarch64: "arm64",
  arm64: "arm64",
};

export function resolveRemotePlatform(
  os: string,
  arch: string,
): { platform: string; arch: string } | null {
  const platform = OS_MAP[os];
  const resolvedArch = ARCH_MAP[arch];
  if (!platform || !resolvedArch) return null;
  return { platform, arch: resolvedArch };
}

// ── Remote file paths ─────────────────────────────────────────────────

export function remoteT3Home(): string {
  return "$HOME/.t3";
}

export function remoteServerBinPath(): string {
  return "$HOME/.t3/bin/t3";
}

export function remoteTmuxBinPath(): string {
  return "$HOME/.t3/bin/tmux";
}

export function remoteProjectRunDir(projectId: string): string {
  return `$HOME/.t3/run/${projectId}`;
}

export function remoteServerStateFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/server.json`;
}

export function remoteAuthTokenFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/auth-token`;
}

export function remoteEnvFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/env`;
}

// ── tmux helpers ──────────────────────────────────────────────────────

export function tmuxSessionName(projectId: string): string {
  // Truncate to 50 chars to avoid tmux name limits
  return `t3-${projectId}`.slice(0, 50);
}

export function parseTmuxSessionList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.split(":")[0]?.trim() ?? "")
    .filter((name) => name.length > 0);
}

export function buildTmuxCheckCommand(projectId: string): string {
  const session = tmuxSessionName(projectId);
  return `$HOME/.t3/bin/tmux has-session -t ${session} 2>/dev/null && echo "exists" || echo "absent"`;
}

export function buildTmuxStartCommand(projectId: string, workspaceRoot: string): string {
  const session = tmuxSessionName(projectId);
  const stateFile = remoteServerStateFile(projectId);
  const authFile = remoteAuthTokenFile(projectId);
  const logDir = `$HOME/.t3/run/${projectId}/logs`;
  return [
    `mkdir -p ${logDir}`,
    `$HOME/.t3/bin/tmux new-session -d -s ${session}`,
    `"$HOME/.t3/bin/t3 serve`,
    `--host 127.0.0.1`,
    `--port 0`,
    `--auth-token-file ${authFile}`,
    `--state-file ${stateFile}`,
    `--log-dir ${logDir}`,
    `--cwd ${workspaceRoot}"`,
  ].join(" ");
}

export function buildTmuxKillCommand(projectId: string): string {
  const session = tmuxSessionName(projectId);
  return `$HOME/.t3/bin/tmux kill-session -t ${session} 2>/dev/null || true`;
}
```

**Step 4: Run tests to verify they pass**

```bash
bun run test packages/shared/src/ssh.test.ts
```

Expected: All 7 tests pass.

**Step 5: Add subpath export to `packages/shared/package.json`**

Add to the `exports` field:

```json
"./ssh": {
  "import": "./src/ssh.ts",
  "require": "./src/ssh.ts"
}
```

**Step 6: Commit**

```bash
git add packages/shared/src/ssh.ts packages/shared/src/ssh.test.ts packages/shared/package.json
git commit -m "feat(shared): add SSH subprocess utilities"
```

---

## Task 4: Server — `--auth-token-file` and `--state-file` CLI flags (headless mode)

**Files:**

- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/serverRuntimeStartup.ts`

**Step 1: Add flags to `cli.ts`**

Add after existing flags:

```typescript
const authTokenFileFlag = Flag.string("auth-token-file").pipe(
  Flag.withDescription(
    "Path to file containing the auth token. Server re-reads this file on each WebSocket handshake. Used in headless/remote mode.",
  ),
  Flag.optional,
);

const stateFileFlag = Flag.string("state-file").pipe(
  Flag.withDescription(
    "Path to JSON file where server writes its port and PID on startup. Used in headless/remote mode.",
  ),
  Flag.optional,
);

const logDirFlag = Flag.string("log-dir").pipe(
  Flag.withDescription("Directory for rotating server log files. Overrides the default logs path."),
  Flag.optional,
);

const headlessFlag = Flag.boolean("headless").pipe(
  Flag.withDescription("Headless mode: do not serve static UI files. Used for remote operation."),
  Flag.withDefault(false),
);
```

Add to `commandFlags` object:

```typescript
authTokenFile: authTokenFileFlag,
stateFile: stateFileFlag,
logDir: logDirFlag,
headless: headlessFlag,
```

**Step 2: Add to `ServerConfigShape` in `config.ts`**

```typescript
authTokenFile: Option.Option<string>;
stateFile: Option.Option<string>;
logDir: Option.Option<string>;
headless: boolean;
```

**Step 3: Resolve in `resolveServerConfig` in `cli.ts`**

```typescript
authTokenFile: Option.fromNullable(flags.authTokenFile ?? undefined),
stateFile: Option.fromNullable(flags.stateFile ?? undefined),
logDir: Option.fromNullable(flags.logDir ?? undefined),
headless: flags.headless ?? false,
```

**Step 4: Write state file on startup in `serverRuntimeStartup.ts`**

After the server starts listening, if `stateFile` is set, write:

```typescript
if (Option.isSome(config.stateFile)) {
  const state = JSON.stringify({
    port: config.port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  await fs.writeFile(config.stateFile.value, state, "utf8");
}
```

**Step 5: Implement auth token file reading**

In the WebSocket auth middleware, if `authTokenFile` is set, read the file on each connection attempt instead of using the in-memory token. This enables token rotation without restart.

**Step 6: Skip static file serving when headless**

In `server.ts` routes, wrap static file route in:

```typescript
if (!config.headless) {
  // ... serve static files
}
```

**Step 7: Build and verify**

```bash
bun run --cwd apps/server typecheck
```

Expected: No type errors.

**Step 8: Commit**

```bash
git add apps/server/src/cli.ts apps/server/src/config.ts apps/server/src/server.ts apps/server/src/serverRuntimeStartup.ts
git commit -m "feat(server): add headless mode with auth-token-file, state-file, log-dir flags"
```

---

## Task 5: Server — TERM override for PTY and SSH_AUTH_SOCK propagation

**Files:**

- Modify: `apps/server/src/terminal/Layers/BunPTY.ts`
- Modify: `apps/server/src/terminal/Layers/NodePTY.ts`
- Modify: `apps/server/src/provider/Layers/CodexAdapter.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`

**Step 1: Override TERM in PTY layers**

In both `BunPTY.ts` and `NodePTY.ts`, when constructing the PTY environment, always force:

```typescript
const ptyEnv = {
  ...process.env,
  ...input.env,
  TERM: "xterm-256color", // override regardless of SSH session TERM
};
```

**Step 2: Add env file watcher to config**

In `apps/server/src/config.ts`, add:

```typescript
envFile: Option.Option<string>; // ~/.t3/run/<projectId>/env
```

**Step 3: Implement SSH_AUTH_SOCK propagation service**

Create `apps/server/src/remote/Services/RemoteEnv.ts`:

```typescript
export interface RemoteEnvShape {
  readonly getSshAuthSock: () => Effect.Effect<string | undefined>;
}

export class RemoteEnv extends ServiceMap.Service<RemoteEnv, RemoteEnvShape>()(
  "t3/remote/Services/RemoteEnv",
) {}
```

Create `apps/server/src/remote/Layers/RemoteEnv.ts`:

- If `envFile` config is set, watch the file and parse `SSH_AUTH_SOCK=...` lines
- If not set, fall back to `process.env.SSH_AUTH_SOCK`
- Exposes `getSshAuthSock()` to get current value

**Step 4: Inject into provider and terminal subprocess environments**

In `CodexAdapter.ts` and `ClaudeAdapter.ts`, yield `RemoteEnv` and add `SSH_AUTH_SOCK` to subprocess env if available:

```typescript
const sshAuthSock = yield * remoteEnv.getSshAuthSock();
const subprocessEnv = {
  ...baseEnv,
  ...(sshAuthSock ? { SSH_AUTH_SOCK: sshAuthSock } : {}),
};
```

**Step 5: Commit**

```bash
git add apps/server/src/terminal/Layers/ apps/server/src/provider/Layers/ apps/server/src/remote/
git commit -m "feat(server): force TERM=xterm-256color in PTY, propagate SSH_AUTH_SOCK from env file"
```

---

## Task 6: Server — remoteHost in project commands + migration

**Files:**

- Create: `apps/server/src/persistence/Migrations/020_ProjectionProjectsRemoteHost.ts`
- Modify: `apps/server/src/orchestration/decider.ts`
- Modify: `apps/server/src/orchestration/projector.ts`
- Modify: `apps/server/src/persistence/Layers/ProjectionProjects.ts`

**Step 1: Write migration**

Create `020_ProjectionProjectsRemoteHost.ts`:

```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN remote_host_json TEXT
  `;
});
```

**Step 2: Update decider to pass through `remoteHost`**

In `decider.ts`, when handling `project.create` command, include `remoteHost` in the produced `project.created` event payload.

**Step 3: Update projector to persist `remoteHost`**

In `projector.ts`, when applying `project.created` event, include `remoteHost` in the projection upsert.

**Step 4: Update `ProjectionProjects` layer**

Add `remoteHost` to project read queries — deserialize from `remote_host_json` column.

**Step 5: Update `OrchestrationReadModel` projection**

Ensure `OrchestrationProject.remoteHost` is populated when building the snapshot.

**Step 6: Verify typecheck**

```bash
bun run --cwd apps/server typecheck
```

Expected: No errors.

**Step 7: Commit**

```bash
git add apps/server/src/persistence/Migrations/020_ProjectionProjectsRemoteHost.ts apps/server/src/orchestration/
git commit -m "feat(server): persist remoteHost on projects via migration 020"
```

---

## Task 7: Server — disconnect-aware turn pause (approval-required mode)

**Files:**

- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/orchestration/Layers/OrchestrationReactor.ts`

**Step 1: Track connected client count**

In `ws.ts`, maintain an `Effect.Ref` tracking the count of connected WebSocket clients. Increment on connect, decrement on disconnect.

**Step 2: Emit lifecycle event on last client disconnect**

When count drops to 0, emit a `ClientsDisconnected` internal event via the `ServerLifecycleEvents` service.

**Step 3: Handle in `OrchestrationReactor`**

Subscribe to `ClientsDisconnected`. For each thread with an active turn:

- If `runtimeMode === "approval-required"` → dispatch `thread.turn.interrupt` command
- If `runtimeMode === "full-access"` → do nothing (let the agent continue)

**Step 4: Commit**

```bash
git add apps/server/src/ws.ts apps/server/src/orchestration/Layers/OrchestrationReactor.ts
git commit -m "feat(server): pause AI turns on client disconnect in approval-required mode"
```

---

## Task 8: Shared — SSH connection manager (subprocess lifecycle)

**Files:**

- Create: `packages/shared/src/sshManager.ts`
- Create: `packages/shared/src/sshManager.test.ts`
- Modify: `packages/shared/package.json`

**Step 1: Write failing tests**

Create `packages/shared/src/sshManager.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SshConnectionManager } from "./sshManager";

describe("SshConnectionManager", () => {
  it("returns cached connection for same target", async () => {
    const manager = new SshConnectionManager({ spawn: vi.fn().mockReturnValue({ pid: 123 }) });
    // First connection
    const c1 = await manager.getOrCreate({ host: "devbox", user: "james", port: 22 });
    // Second connection — same host
    const c2 = await manager.getOrCreate({ host: "devbox", user: "james", port: 22 });
    expect(c1).toBe(c2);
    expect(manager["spawn"]).toHaveBeenCalledTimes(1);
  });

  it("creates separate connections for different hosts", async () => {
    const manager = new SshConnectionManager({ spawn: vi.fn().mockReturnValue({ pid: 123 }) });
    await manager.getOrCreate({ host: "devbox1", user: "james", port: 22 });
    await manager.getOrCreate({ host: "devbox2", user: "james", port: 22 });
    expect(manager["spawn"]).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run to verify failure**

```bash
bun run test packages/shared/src/sshManager.test.ts
```

Expected: FAIL.

**Step 3: Create `packages/shared/src/sshManager.ts`**

```typescript
/**
 * SshConnectionManager — manages SSH master connections per host.
 *
 * Uses a connection key (user@host:port) to deduplicate master connections.
 * Tracks child processes and cleans them up on close.
 *
 * @module sshManager
 */
import { type ChildProcess, spawn } from "node:child_process";
import { buildSshArgs, buildCheckSocketArgs, controlSocketPath, type SshTarget } from "./ssh";

type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

interface ManagedConnection {
  target: SshTarget;
  process: ChildProcess | null;
  established: boolean;
}

export class SshConnectionManager {
  private connections = new Map<string, ManagedConnection>();
  private readonly spawn: SpawnFn;

  constructor(opts?: { spawn?: SpawnFn }) {
    this.spawn = opts?.spawn ?? ((cmd, args) => spawn(cmd, args, { stdio: "ignore" }));
  }

  private connectionKey(target: SshTarget): string {
    return `${target.user}@${target.host}:${target.port}`;
  }

  async checkControlSocket(target: SshTarget): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = this.spawn("ssh", buildCheckSocketArgs(target));
      proc.on("exit", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async getOrCreate(target: SshTarget): Promise<ManagedConnection> {
    const key = this.connectionKey(target);
    const existing = this.connections.get(key);
    if (existing) return existing;

    // Check if a control socket already exists (from user's terminal session)
    const socketExists = await this.checkControlSocket(target);
    const conn: ManagedConnection = { target, process: null, established: socketExists };

    if (!socketExists) {
      // Establish our own master connection
      const proc = this.spawn("ssh", [...buildSshArgs(target, ["-N", "-f"])]);
      conn.process = proc;
      conn.established = true;
    }

    this.connections.set(key, conn);
    return conn;
  }

  async close(target: SshTarget): Promise<void> {
    const key = this.connectionKey(target);
    const conn = this.connections.get(key);
    if (!conn) return;
    conn.process?.kill("SIGTERM");
    this.connections.delete(key);
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.process?.kill("SIGTERM");
    }
    this.connections.clear();
  }
}
```

**Step 4: Run tests**

```bash
bun run test packages/shared/src/sshManager.test.ts
```

Expected: All tests pass.

**Step 5: Add subpath export**

```json
"./sshManager": {
  "import": "./src/sshManager.ts",
  "require": "./src/sshManager.ts"
}
```

**Step 6: Commit**

```bash
git add packages/shared/src/sshManager.ts packages/shared/src/sshManager.test.ts packages/shared/package.json
git commit -m "feat(shared): add SshConnectionManager for master connection lifecycle"
```

---

## Task 9: Server — Remote provisioner

**Files:**

- Create: `apps/server/src/remote/Provisioner.ts`
- Create: `apps/server/src/remote/Provisioner.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { parseServerStateFile, buildProbeCommand, buildStartServerCommand } from "./Provisioner";

describe("parseServerStateFile", () => {
  it("parses valid state file", () => {
    const json = JSON.stringify({ port: 38100, pid: 12345, startedAt: "2026-01-01T00:00:00Z" });
    expect(parseServerStateFile(json)).toEqual({ port: 38100, pid: 12345 });
  });

  it("returns null for invalid JSON", () => {
    expect(parseServerStateFile("not json")).toBeNull();
  });

  it("returns null for missing port", () => {
    expect(parseServerStateFile(JSON.stringify({ pid: 123 }))).toBeNull();
  });
});

describe("buildProbeCommand", () => {
  it("includes t3 version check", () => {
    const cmd = buildProbeCommand();
    expect(cmd).toContain("uname -s");
    expect(cmd).toContain("uname -m");
    expect(cmd).toContain(".t3/bin/t3");
  });
});

describe("buildStartServerCommand", () => {
  it("includes projectId in tmux session name", () => {
    const cmd = buildStartServerCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("t3-proj-abc");
    expect(cmd).toContain("/home/james/myapp");
  });
});
```

**Step 2: Run to verify failures**

```bash
bun run test apps/server/src/remote/Provisioner.test.ts
```

Expected: FAIL.

**Step 3: Implement `Provisioner.ts`**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseProbeOutput,
  resolveRemotePlatform,
  buildSshArgs,
  buildPortForwardArgs,
  buildCancelForwardArgs,
  buildTmuxCheckCommand,
  buildTmuxStartCommand,
  buildTmuxKillCommand,
  remoteAuthTokenFile,
  remoteEnvFile,
  remoteServerStateFile,
  PROBE_SCRIPT,
  type SshTarget,
} from "@t3tools/shared/ssh";
import { SshConnectionManager } from "@t3tools/shared/sshManager";

const execFileAsync = promisify(execFile);

export interface ServerState {
  port: number;
  pid: number;
}

export function parseServerStateFile(json: string): ServerState | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.port !== "number" || typeof parsed.pid !== "number") return null;
    return { port: parsed.port, pid: parsed.pid };
  } catch {
    return null;
  }
}

export function buildProbeCommand(): string {
  return PROBE_SCRIPT;
}

export function buildStartServerCommand(projectId: string, workspaceRoot: string): string {
  return buildTmuxStartCommand(projectId, workspaceRoot);
}

export interface ProvisionResult {
  port: number;
  localPort: number;
}

export interface ProvisionerOptions {
  target: SshTarget;
  projectId: string;
  workspaceRoot: string;
  localVersion: string;
  /** Path to server binary to upload if needed */
  serverBinaryPath: (platform: string, arch: string) => string;
  /** Path to tmux binary to upload if needed */
  tmuxBinaryPath: (platform: string, arch: string) => string;
  sshManager: SshConnectionManager;
  onStatus?: (phase: string) => void;
}

export async function provision(opts: ProvisionerOptions): Promise<ProvisionResult> {
  const { target, projectId, workspaceRoot, localVersion, onStatus } = opts;

  onStatus?.("provisioning");

  // Ensure master connection exists
  await opts.sshManager.getOrCreate(target);

  // Run probe script
  const probeOutput = await runSshCommand(target, buildProbeCommand());
  const probe = parseProbeOutput(probeOutput);
  if (!probe) throw new Error(`Failed to parse probe output: ${probeOutput}`);

  const platform = resolveRemotePlatform(probe.os, probe.arch);
  if (!platform) {
    throw new Error(`Unsupported remote platform: ${probe.os}/${probe.arch}`);
  }

  // Transfer binaries if needed
  if (probe.currentVersion !== localVersion) {
    onStatus?.("provisioning");
    await scpFile(
      target,
      opts.serverBinaryPath(platform.platform, platform.arch),
      "$HOME/.t3/bin/t3",
    );
    await scpFile(
      target,
      opts.tmuxBinaryPath(platform.platform, platform.arch),
      "$HOME/.t3/bin/tmux",
    );
    await runSshCommand(target, "chmod +x $HOME/.t3/bin/t3 $HOME/.t3/bin/tmux");
  }

  // Check if tmux session exists (fast path)
  onStatus?.("starting");
  const tmuxCheck = await runSshCommand(target, buildTmuxCheckCommand(projectId));

  let remotePort: number;

  if (tmuxCheck.trim() === "exists") {
    // Fast path: read existing port
    const stateJson = await runSshCommand(target, `cat ${remoteServerStateFile(projectId)}`);
    const state = parseServerStateFile(stateJson);
    if (!state) throw new Error("Remote server state file missing or corrupt");
    remotePort = state.port;
  } else {
    // Cold start: generate token, start server
    const authToken = crypto.randomUUID();
    await runSshCommand(
      target,
      `mkdir -p $HOME/.t3/run/${projectId}/logs && printf '%s' '${authToken}' > ${remoteAuthTokenFile(projectId)}`,
    );
    await runSshCommand(target, buildStartServerCommand(projectId, workspaceRoot));

    // Poll for state file (up to 10s)
    remotePort = await waitForStateFile(target, projectId);
  }

  // Write fresh auth token (reconnect path also does this)
  const freshToken = crypto.randomUUID();
  await runSshCommand(target, `printf '%s' '${freshToken}' > ${remoteAuthTokenFile(projectId)}`);

  // Write SSH_AUTH_SOCK to env file
  const sshAuthSock = process.env.SSH_AUTH_SOCK ?? "";
  if (sshAuthSock) {
    await runSshCommand(
      target,
      `printf 'SSH_AUTH_SOCK=%s' '${sshAuthSock}' > ${remoteEnvFile(projectId)}`,
    );
  }

  // Set up port forward
  const localPort = await findLocalPort();
  await runSshCommand(target, buildPortForwardArgs({ ...target, localPort, remotePort }).join(" "));

  onStatus?.("connected");
  return { port: remotePort, localPort };
}

async function waitForStateFile(
  target: SshTarget,
  projectId: string,
  timeoutMs = 10_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const json = await runSshCommand(
        target,
        `cat ${remoteServerStateFile(projectId)} 2>/dev/null`,
      );
      const state = parseServerStateFile(json);
      if (state) return state.port;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for remote server to start");
}

async function runSshCommand(target: SshTarget, command: string): Promise<string> {
  const args = [...buildSshArgs(target), command];
  const { stdout } = await execFileAsync("ssh", args, { timeout: 30_000 });
  return stdout;
}

async function scpFile(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
  const dest = `${target.user}@${target.host}:${remotePath}`;
  await execFileAsync("scp", ["-P", String(target.port), localPath, dest], { timeout: 120_000 });
}

async function findLocalPort(): Promise<number> {
  // Uses Node's net.createServer to find a free local port
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("Could not find free port"));
      });
    });
  });
}
```

**Step 4: Run tests**

```bash
bun run test apps/server/src/remote/Provisioner.test.ts
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/server/src/remote/
git commit -m "feat(server): add remote provisioner for SSH lifecycle management"
```

---

## Task 10: Server — `t3 broker` CLI mode

**Files:**

- Create: `apps/server/src/broker/BrokerServer.ts`
- Modify: `apps/server/src/cli.ts`

**Step 1: Create `BrokerServer.ts`**

The broker runs a local-only WebSocket server on port 3774. It accepts JSON messages matching the broker RPC contract and manages SSH connections via the provisioner.

Key structure:

```typescript
export async function runBroker(port = 3774): Promise<void> {
  const { WebSocketServer } = await import("ws");
  const manager = new SshConnectionManager();
  const connections = new Map<string, { wsUrl: string; localPort: number }>();
  const wss = new WebSocketServer({ host: "127.0.0.1", port });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.method === "broker.connect") {
        try {
          const result = await provision({
            target: { host: msg.host, user: msg.user, port: msg.port ?? 22 },
            projectId: msg.projectId,
            workspaceRoot: msg.workspaceRoot,
            localVersion: pkg.version,
            serverBinaryPath: (platform, arch) => resolveServerBinary(platform, arch),
            tmuxBinaryPath: (platform, arch) => resolveTmuxBinary(platform, arch),
            sshManager: manager,
          });
          const wsUrl = `ws://127.0.0.1:${result.localPort}`;
          connections.set(msg.projectId, { wsUrl, localPort: result.localPort });
          ws.send(JSON.stringify({ id: msg.id, wsUrl }));
        } catch (err) {
          ws.send(JSON.stringify({ id: msg.id, error: String(err) }));
        }
      }

      if (msg.method === "broker.disconnect") {
        connections.delete(msg.projectId);
        ws.send(JSON.stringify({ id: msg.id, ok: true }));
      }

      if (msg.method === "broker.status") {
        ws.send(JSON.stringify({ id: msg.id, connections: [...connections.keys()] }));
      }
    });
  });

  console.log(`[t3 broker] listening on ws://127.0.0.1:${port}`);
  await new Promise(() => {}); // run forever
}
```

**Step 2: Add `broker` subcommand to `cli.ts`**

```typescript
const brokerCommand = Command.make("broker").pipe(
  Command.withDescription("Run the local SSH connection broker for web browser clients."),
  Command.withHandler(() =>
    Effect.promise(() => import("./broker/BrokerServer").then((m) => m.runBroker())),
  ),
);

export const cli = rootCommand.pipe(Command.withSubcommands([brokerCommand]));
```

**Step 3: Commit**

```bash
git add apps/server/src/broker/ apps/server/src/cli.ts
git commit -m "feat(server): add t3 broker CLI mode for web SSH lifecycle management"
```

---

## Task 11: Desktop — SSH lifecycle management via IPC

**Files:**

- Create: `apps/desktop/src/sshManager.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`

**Step 1: Create `apps/desktop/src/sshManager.ts`**

Wraps the provisioner in the Electron main process context:

```typescript
import { SshConnectionManager } from "@t3tools/shared/sshManager";
import { provision, type ProvisionResult } from "../server/src/remote/Provisioner";

// Singleton manager for Electron process lifetime
export const globalSshManager = new SshConnectionManager();

const activeConnections = new Map<string, ProvisionResult>();

export async function sshConnect(opts: {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  localVersion: string;
  onStatus: (phase: string) => void;
}): Promise<{ wsUrl: string }> {
  const result = await provision({
    target: { host: opts.host, user: opts.user, port: opts.port },
    projectId: opts.projectId,
    workspaceRoot: opts.workspaceRoot,
    localVersion: opts.localVersion,
    serverBinaryPath: resolveServerBinaryPath,
    tmuxBinaryPath: resolveTmuxBinaryPath,
    sshManager: globalSshManager,
    onStatus: opts.onStatus,
  });
  activeConnections.set(opts.projectId, result);
  return { wsUrl: `ws://127.0.0.1:${result.localPort}` };
}

export function sshDisconnect(projectId: string): void {
  activeConnections.delete(projectId);
  // Port forward released; tmux session stays running for fast reconnect
}

export function sshStatus(): { connections: string[] } {
  return { connections: [...activeConnections.keys()] };
}

function resolveServerBinaryPath(platform: string, arch: string): string {
  // In packaged app, binaries are in resources/ssh-binaries/
  // In dev, look in dist/ from CI artifacts
  return path.join(app.getAppPath(), "resources", "ssh-binaries", `t3-server-${platform}-${arch}`);
}

function resolveTmuxBinaryPath(platform: string, arch: string): string {
  return path.join(app.getAppPath(), "resources", "ssh-binaries", `tmux-${platform}-${arch}`);
}
```

**Step 2: Register IPC handlers in `main.ts`**

```typescript
ipcMain.handle("desktop:ssh-connect", async (_, opts) => {
  return sshConnect({
    ...opts,
    localVersion: app.getVersion(),
    onStatus: (phase) => {
      mainWindow?.webContents.send("desktop:ssh-status-update", {
        projectId: opts.projectId,
        phase,
      });
    },
  });
});

ipcMain.handle("desktop:ssh-disconnect", async (_, { projectId }) => {
  sshDisconnect(projectId);
  return { ok: true };
});

ipcMain.handle("desktop:ssh-status", async () => {
  return sshStatus();
});
```

**Step 3: Expose in `preload.ts`**

```typescript
sshConnect: (opts) => ipcRenderer.invoke("desktop:ssh-connect", opts),
sshDisconnect: (projectId) => ipcRenderer.invoke("desktop:ssh-disconnect", { projectId }),
sshStatus: () => ipcRenderer.invoke("desktop:ssh-status"),
onSshStatusUpdate: (listener) =>
  ipcRenderer.on("desktop:ssh-status-update", (_, update) => listener(update)),
```

**Step 4: Add eager warm-up on launch**

In `main.ts`, after loading the main window, schedule warm-up:

```typescript
// Warm up SSH connections for recently-used remote hosts
setTimeout(async () => {
  const recentHosts = await loadRecentRemoteHosts(); // from orchestration DB
  for (const host of recentHosts) {
    globalSshManager.getOrCreate(host).catch(() => {
      // warm-up is best-effort; ignore failures
    });
  }
}, 2000); // delay until after UI is ready
```

**Step 5: Commit**

```bash
git add apps/desktop/src/sshManager.ts apps/desktop/src/main.ts apps/desktop/src/preload.ts
git commit -m "feat(desktop): SSH lifecycle management via IPC channels"
```

---

## Task 12: Web — Broker client and connection state store

**Files:**

- Create: `apps/web/src/rpc/brokerClient.ts`
- Create: `apps/web/src/remoteConnectionStore.ts`

**Step 1: Create broker client**

`apps/web/src/rpc/brokerClient.ts`:

```typescript
import type { RemoteConnectionStatus } from "@t3tools/contracts";

const BROKER_URL = "ws://127.0.0.1:3774";

interface BrokerMessage {
  id: string;
  method: string;
  [key: string]: unknown;
}

class BrokerClient {
  private ws: WebSocket | null = null;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(BROKER_URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("Cannot connect to t3 broker"));
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg);
        }
      };
    });
  }

  async send<T>(msg: BrokerMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify(msg));
    });
  }

  async connectProject(opts: {
    projectId: string;
    host: string;
    user: string;
    port: number;
    workspaceRoot: string;
  }): Promise<{ wsUrl: string }> {
    const id = crypto.randomUUID();
    return this.send({ id, method: "broker.connect", ...opts });
  }

  async disconnectProject(projectId: string): Promise<void> {
    const id = crypto.randomUUID();
    await this.send({ id, method: "broker.disconnect", projectId });
  }
}

export const brokerClient = new BrokerClient();
```

**Step 2: Create remote connection Zustand store**

`apps/web/src/remoteConnectionStore.ts`:

```typescript
import { create } from "zustand";
import type { RemoteConnectionStatus } from "@t3tools/contracts";

interface RemoteConnectionEntry {
  projectId: string;
  status: RemoteConnectionStatus;
  wsUrl?: string;
  error?: string;
}

interface RemoteConnectionStore {
  connections: Record<string, RemoteConnectionEntry>;
  setStatus(
    projectId: string,
    status: RemoteConnectionStatus,
    extra?: Partial<RemoteConnectionEntry>,
  ): void;
  getStatus(projectId: string): RemoteConnectionStatus;
  getWsUrl(projectId: string): string | undefined;
}

export const useRemoteConnectionStore = create<RemoteConnectionStore>((set, get) => ({
  connections: {},

  setStatus(projectId, status, extra = {}) {
    set((state) => ({
      connections: {
        ...state.connections,
        [projectId]: { ...state.connections[projectId], projectId, status, ...extra },
      },
    }));
  },

  getStatus(projectId) {
    return get().connections[projectId]?.status ?? "disconnected";
  },

  getWsUrl(projectId) {
    return get().connections[projectId]?.wsUrl;
  },
}));
```

**Step 3: Commit**

```bash
git add apps/web/src/rpc/brokerClient.ts apps/web/src/remoteConnectionStore.ts
git commit -m "feat(web): add broker client and remote connection state store"
```

---

## Task 13: Web — Remote project connection hook

**Files:**

- Create: `apps/web/src/hooks/useRemoteProjectConnection.ts`

**Step 1: Create the hook**

This hook handles the full connect/reconnect lifecycle for a remote project:

```typescript
import { useEffect, useRef, useCallback } from "react";
import { useRemoteConnectionStore } from "../remoteConnectionStore";
import { brokerClient } from "../rpc/brokerClient";
import type { OrchestrationProject } from "@t3tools/contracts";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RETRY_MS = 5 * 60 * 1000;

export function useRemoteProjectConnection(project: OrchestrationProject | null) {
  const { setStatus } = useRemoteConnectionStore();
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTime = useRef<number>(0);
  const aborted = useRef(false);

  const connect = useCallback(async () => {
    if (!project?.remoteHost || aborted.current) return;

    const { host, user, port = 22 } = project.remoteHost;

    setStatus(project.id, "provisioning");

    try {
      await brokerClient.connect().catch(() => {
        throw new Error("t3 broker is not running. Start it with: t3 broker");
      });

      const { wsUrl } = await brokerClient.connectProject({
        projectId: project.id,
        host,
        user,
        port,
        workspaceRoot: project.workspaceRoot,
      });

      retryCount.current = 0;
      setStatus(project.id, "connected", { wsUrl });
    } catch (err) {
      const elapsed = Date.now() - startTime.current;
      if (elapsed > MAX_RETRY_MS || aborted.current) {
        setStatus(project.id, "error", { error: String(err) });
        return;
      }

      setStatus(project.id, "reconnecting");
      const delay = BACKOFF_MS[Math.min(retryCount.current, BACKOFF_MS.length - 1)] ?? 30000;
      retryCount.current++;
      retryTimer.current = setTimeout(connect, delay);
    }
  }, [project, setStatus]);

  useEffect(() => {
    if (!project?.remoteHost) return;
    aborted.current = false;
    startTime.current = Date.now();
    connect();

    return () => {
      aborted.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (project) {
        brokerClient.disconnectProject(project.id).catch(() => {});
        setStatus(project.id, "disconnected");
      }
    };
  }, [project?.id, connect, setStatus]);
}
```

**Step 2: Commit**

```bash
git add apps/web/src/hooks/useRemoteProjectConnection.ts
git commit -m "feat(web): add useRemoteProjectConnection hook with auto-reconnect"
```

---

## Task 14: Web — Add Remote Project UI

**Files:**

- Create: `apps/web/src/components/AddRemoteProjectDialog.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Create dialog component**

```tsx
import { useState } from "react";
import { useNativeApi } from "../nativeApi";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddRemoteProjectDialog({ open, onClose }: Props) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState(() => process.env.USER ?? "");
  const [port, setPort] = useState("22");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const api = useNativeApi();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.orchestration.dispatchCommand({
        _tag: "project.create",
        commandId: crypto.randomUUID(),
        title: label || `${user}@${host}:${workspaceRoot}`,
        workspaceRoot,
        remoteHost: { host, user, port: Number(port), label: label || undefined },
        scripts: [],
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <dialog open className="remote-project-dialog">
      <h2>Add Remote Project</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Host
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="devbox"
            required
          />
        </label>
        <label>
          User
          <input value={user} onChange={(e) => setUser(e.target.value)} required />
        </label>
        <label>
          Port
          <input value={port} onChange={(e) => setPort(e.target.value)} type="number" />
        </label>
        <label>
          Remote workspace path
          <input
            value={workspaceRoot}
            onChange={(e) => setWorkspaceRoot(e.target.value)}
            placeholder="/home/james/myapp"
            required
          />
        </label>
        <label>
          Label (optional)
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My Dev Server"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? "Connecting…" : "Add Remote Project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
```

**Step 2: Add connection status indicator to Sidebar**

In `Sidebar.tsx`, for each project that has `remoteHost`, show a status dot:

```tsx
import { useRemoteConnectionStore } from "../remoteConnectionStore";

// Inside project list item render:
const status = useRemoteConnectionStore((s) => s.getStatus(project.id));
const statusColor = {
  connected: "green",
  provisioning: "yellow",
  starting: "yellow",
  reconnecting: "yellow",
  error: "red",
  disconnected: "grey",
}[status];

// Render a colored dot: <span className={`remote-dot remote-dot--${statusColor}`} />
```

**Step 3: Commit**

```bash
git add apps/web/src/components/AddRemoteProjectDialog.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add remote project creation dialog and sidebar connection indicators"
```

---

## Task 15: CI/Release — Server binary and tmux bundle builds

**Files:**

- Modify: `.github/workflows/release.yml`
- Create: `scripts/build-ssh-binaries.sh`

**Step 1: Create `scripts/build-ssh-binaries.sh`**

```bash
#!/bin/bash
# Builds standalone t3 server binaries for remote SSH provisioning
set -euo pipefail

OUTPUT_DIR="${1:-dist/ssh-binaries}"
mkdir -p "$OUTPUT_DIR"

# Build server binary for each target
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  PLATFORM="${target%-*}"
  ARCH="${target#*-}"
  echo "Building t3-server-${PLATFORM}-${ARCH}..."
  # Use Bun's cross-compile capability
  bun build apps/server/src/bin.ts \
    --compile \
    --target=bun-${PLATFORM}-${ARCH} \
    --outfile "$OUTPUT_DIR/t3-server-${PLATFORM}-${ARCH}"
done

echo "Server binaries built in $OUTPUT_DIR"
```

**Step 2: Add tmux static binary sourcing**

For tmux, use pre-built static binaries from https://github.com/nicowillis/tmux-static-builds or a similar source. Add a download step to the release workflow:

```yaml
- name: Download static tmux binaries
  run: |
    mkdir -p dist/ssh-binaries
    # linux-arm64
    curl -L -o dist/ssh-binaries/tmux-linux-arm64 \
      "https://github.com/nicowillis/tmux-static-builds/releases/latest/download/tmux-linux-arm64"
    # linux-x64
    curl -L -o dist/ssh-binaries/tmux-linux-x64 \
      "https://github.com/nicowillis/tmux-static-builds/releases/latest/download/tmux-linux-x64"
    chmod +x dist/ssh-binaries/tmux-*
```

> **Note:** Evaluate and pin a specific version of the tmux static builds source. Verify binaries are from a trusted source before publishing.

**Step 3: Add to release workflow**

In `release.yml`, after the desktop build matrix completes, add a step to build and upload SSH binaries:

```yaml
- name: Build SSH server binaries
  run: bash scripts/build-ssh-binaries.sh dist/ssh-binaries

- name: Upload SSH binaries to release
  run: |
    for f in dist/ssh-binaries/*; do
      gh release upload "$RELEASE_TAG" "$f"
    done
```

**Step 4: Bundle into Electron app resources**

In `apps/desktop/electron-builder.yml` (or equivalent), add to `extraResources`:

```yaml
extraResources:
  - from: dist/ssh-binaries
    to: ssh-binaries
    filter: ["**/*"]
```

**Step 5: Commit**

```bash
git add scripts/build-ssh-binaries.sh .github/workflows/release.yml
git commit -m "feat(ci): build and publish standalone server and tmux binaries for SSH provisioning"
```

---

## Task 16: Integration smoke test — end-to-end remote flow

**Files:**

- Create: `apps/server/src/remote/Provisioner.integration.test.ts`

**Step 1: Write integration test (skipped without SSH target)**

```typescript
import { describe, it, expect } from "vitest";
import { provision } from "./Provisioner";
import { SshConnectionManager } from "@t3tools/shared/sshManager";

// Set SSH_INTEGRATION_HOST=user@hostname to run these tests
const INTEGRATION_HOST = process.env.SSH_INTEGRATION_HOST;

describe.skipIf(!INTEGRATION_HOST)("provision — integration", () => {
  it("provisions and starts a server on the remote host", async () => {
    const [user, host] = INTEGRATION_HOST!.split("@");
    const manager = new SshConnectionManager();

    const statuses: string[] = [];
    const result = await provision({
      target: { host: host!, user: user!, port: 22 },
      projectId: "integration-test-001",
      workspaceRoot: "/tmp/t3-integration-test",
      localVersion: "test",
      serverBinaryPath: () => process.env.T3_SERVER_BINARY ?? "/tmp/t3-server",
      tmuxBinaryPath: () => process.env.T3_TMUX_BINARY ?? "/tmp/tmux",
      sshManager: manager,
      onStatus: (s) => statuses.push(s),
    });

    expect(result.port).toBeGreaterThan(0);
    expect(result.localPort).toBeGreaterThan(0);
    expect(statuses).toContain("provisioning");
    expect(statuses).toContain("connected");

    manager.closeAll();
  }, 30_000);
});
```

**Step 2: Run the integration test locally (if SSH target available)**

```bash
SSH_INTEGRATION_HOST=james@hephaestus \
T3_SERVER_BINARY=./dist/ssh-binaries/t3-server-linux-arm64 \
T3_TMUX_BINARY=./dist/ssh-binaries/tmux-linux-arm64 \
bun run test apps/server/src/remote/Provisioner.integration.test.ts
```

Expected: PASS (or SKIP if no host configured).

**Step 3: Commit**

```bash
git add apps/server/src/remote/Provisioner.integration.test.ts
git commit -m "test(server): add integration test for remote SSH provisioning"
```

---

## Final checklist before PR

Run all quality checks:

```bash
bun fmt         # must pass
bun lint        # must pass
bun typecheck   # must pass
bun run test    # must pass
```

Verify the full flow manually:

1. Create a remote project in the web UI pointing at a remote host
2. Observe status indicators: `provisioning` → `starting` → `connected`
3. Open a thread, send a message, verify AI responds via remote provider
4. Open a terminal — verify it works with `TERM=xterm-256color`
5. Kill the SSH tunnel manually — verify reconnect kicks in
6. Verify the remote tmux session survives the reconnect

---

## Appendix: Key file reference

| File                                                                         | Purpose                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/contracts/src/orchestration.ts`                                    | `RemoteHost` schema, project model                      |
| `packages/contracts/src/remoteConnection.ts`                                 | Connection state types, broker RPC                      |
| `packages/contracts/src/rpc.ts`                                              | `WsRpcGroup` with log stream method                     |
| `packages/shared/src/ssh.ts`                                                 | Pure SSH argument builders and parsers                  |
| `packages/shared/src/sshManager.ts`                                          | SSH master connection lifecycle                         |
| `apps/server/src/cli.ts`                                                     | `--headless`, `--auth-token-file`, `--state-file` flags |
| `apps/server/src/remote/Provisioner.ts`                                      | Full SSH provision lifecycle                            |
| `apps/server/src/remote/Services/RemoteEnv.ts`                               | SSH_AUTH_SOCK propagation service                       |
| `apps/server/src/broker/BrokerServer.ts`                                     | `t3 broker` WebSocket server                            |
| `apps/server/src/persistence/Migrations/020_ProjectionProjectsRemoteHost.ts` | DB migration                                            |
| `apps/desktop/src/sshManager.ts`                                             | Electron SSH lifecycle + IPC handlers                   |
| `apps/web/src/rpc/brokerClient.ts`                                           | Web broker WebSocket client                             |
| `apps/web/src/remoteConnectionStore.ts`                                      | Connection status Zustand store                         |
| `apps/web/src/hooks/useRemoteProjectConnection.ts`                           | Connect/reconnect hook                                  |
| `apps/web/src/components/AddRemoteProjectDialog.tsx`                         | New remote project UI                                   |
| `scripts/build-ssh-binaries.sh`                                              | CI binary build script                                  |
