# Remote Environment Lifecycle Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the environmentId-keyed remote identity model with a host+user+workspaceRoot identity model, add lazy reconnect, sidebar cloud icons, lifecycle context menus, reconnect detection in the dialog, and a settings panel for remote management.

**Architecture:** The saved environment registry is refactored from `environmentId`-keyed to `identityKey`-keyed (`user@host:port:workspaceRoot`). The `environmentId` becomes a mutable connection detail refreshed on each provision. Startup is lazy — saved remotes render as disconnected and provision on demand. A new `addOrReconnectSavedEnvironment()` replaces `addSavedEnvironment()` and handles both new and existing remotes without throwing.

**Tech Stack:** TypeScript, React 19, Zustand, Effect-TS, Electron IPC, base-ui components, lucide-react icons, Vitest

---

## Task 1: Add RemoteIdentityKey type and helpers to contracts

**Files:**

- Create: `packages/contracts/src/remoteIdentity.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/remoteIdentity.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/contracts/src/remoteIdentity.test.ts
import { describe, it, expect } from "vitest";
import { makeRemoteIdentityKey, parseRemoteIdentityKey } from "./remoteIdentity";

describe("RemoteIdentityKey", () => {
  it("creates a stable key from host+user+port+workspaceRoot", () => {
    const key = makeRemoteIdentityKey({
      host: "devbox.example.com",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/myapp",
    });
    expect(key).toBe("james@devbox.example.com:22:/home/james/myapp");
  });

  it("produces different keys for different workspaces on same host", () => {
    const a = makeRemoteIdentityKey({
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app1",
    });
    const b = makeRemoteIdentityKey({
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app2",
    });
    expect(a).not.toBe(b);
  });

  it("roundtrips through parse", () => {
    const input = { host: "devbox", user: "james", port: 2222, workspaceRoot: "/opt/code" };
    const key = makeRemoteIdentityKey(input);
    const parsed = parseRemoteIdentityKey(key);
    expect(parsed).toEqual(input);
  });

  it("parse returns null for invalid keys", () => {
    expect(parseRemoteIdentityKey("garbage")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/contracts vitest run src/remoteIdentity.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/contracts/src/remoteIdentity.ts
export type RemoteIdentityKey = string & { readonly _tag: "RemoteIdentityKey" };

export interface RemoteIdentityFields {
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
}

export function makeRemoteIdentityKey(fields: RemoteIdentityFields): RemoteIdentityKey {
  return `${fields.user}@${fields.host}:${fields.port}:${fields.workspaceRoot}` as RemoteIdentityKey;
}

export function parseRemoteIdentityKey(key: string): RemoteIdentityFields | null {
  const match = key.match(/^(.+)@(.+):(\d+):(.+)$/);
  if (!match) return null;
  const [, user, host, portStr, workspaceRoot] = match;
  const port = Number.parseInt(portStr!, 10);
  if (!user || !host || !Number.isFinite(port) || !workspaceRoot) return null;
  return { user, host, port, workspaceRoot };
}
```

**Step 4: Export from index**

Add to `packages/contracts/src/index.ts`:

```typescript
export {
  type RemoteIdentityKey,
  type RemoteIdentityFields,
  makeRemoteIdentityKey,
  parseRemoteIdentityKey,
} from "./remoteIdentity.js";
```

**Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/contracts vitest run src/remoteIdentity.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/contracts/src/remoteIdentity.ts packages/contracts/src/remoteIdentity.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add RemoteIdentityKey type and helpers"
```

---

## Task 2: Add SavedRemoteEnvironment type to contracts

**Files:**

- Modify: `packages/contracts/src/ipc.ts`

**Step 1: Add the new type alongside the existing PersistedSavedEnvironmentRecord**

Add after `PersistedSavedEnvironmentRecord` (around line 132):

```typescript
export interface SavedRemoteEnvironment {
  // Identity (immutable after creation)
  identityKey: RemoteIdentityKey;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  label: string;
  createdAt: string;

  // Connection details (mutable, updated on each provision)
  environmentId: EnvironmentId | null;
  wsBaseUrl: string | null;
  httpBaseUrl: string | null;
  lastConnectedAt: string | null;
  projectId: string;
}
```

Import `RemoteIdentityKey` and `EnvironmentId` at the top.

**Step 2: Add new IPC methods to DesktopBridge**

Add to the `DesktopBridge` interface (around line 213):

```typescript
sshProbe: (opts: { host: string; user: string; port: number }) => Promise<{ reachable: boolean }>;
sshKillRemoteSession: (opts: { host: string; user: string; port: number; projectId: string }) =>
  Promise<void>;
```

**Step 3: Run typecheck**

Run: `bun run --cwd packages/contracts typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/contracts/src/ipc.ts
git commit -m "feat(contracts): add SavedRemoteEnvironment type and new IPC methods"
```

---

## Task 3: Implement sshProbe and sshKillRemoteSession in desktop

**Files:**

- Modify: `apps/desktop/src/sshManager.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`

**Step 1: Add sshProbe to sshManager.ts**

After `sshGetStatus()` (around line 92):

```typescript
export async function sshProbe(opts: {
  host: string;
  user: string;
  port: number;
}): Promise<{ reachable: boolean }> {
  const controlPath = controlSocketPath({
    host: opts.host,
    user: opts.user,
    port: opts.port,
  });
  try {
    const { execSync } = await import("node:child_process");
    execSync(`ssh -o ControlPath=${controlPath} -O check ${opts.user}@${opts.host} 2>/dev/null`, {
      timeout: 3000,
    });
    return { reachable: true };
  } catch {
    return { reachable: false };
  }
}

export async function sshKillRemoteSession(opts: {
  host: string;
  user: string;
  port: number;
  projectId: string;
}): Promise<void> {
  const target = { host: opts.host, user: opts.user, port: opts.port };
  try {
    const { runSshCommand } = await import("@t3tools/shared/ssh");
    const { buildTmuxKillCommand } = await import("@t3tools/shared/ssh");
    await runSshCommand(target, buildTmuxKillCommand(opts.projectId));
  } catch {
    // Best-effort — host may be unreachable
  }
}
```

Import `controlSocketPath` from `@t3tools/shared/ssh` at the top.

**Step 2: Register IPC handlers in main.ts**

Add constants (around line 136):

```typescript
const SSH_PROBE_CHANNEL = "desktop:ssh-probe";
const SSH_KILL_REMOTE_SESSION_CHANNEL = "desktop:ssh-kill-remote-session";
```

Add handlers alongside existing SSH handlers (around line 1878):

```typescript
ipcMain.handle(SSH_PROBE_CHANNEL, async (_event, opts) => {
  return sshProbe(opts);
});

ipcMain.handle(SSH_KILL_REMOTE_SESSION_CHANNEL, async (_event, opts) => {
  return sshKillRemoteSession(opts);
});
```

Import `sshProbe` and `sshKillRemoteSession` from `./sshManager`.

**Step 3: Expose in preload.ts**

Add to the bridge object (around line 119):

```typescript
sshProbe: (opts: { host: string; user: string; port: number }) =>
  ipcRenderer.invoke(SSH_PROBE_CHANNEL, opts),
sshKillRemoteSession: (opts: { host: string; user: string; port: number; projectId: string }) =>
  ipcRenderer.invoke(SSH_KILL_REMOTE_SESSION_CHANNEL, opts),
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (may have pre-existing warnings)

**Step 5: Commit**

```bash
git add apps/desktop/src/sshManager.ts apps/desktop/src/main.ts apps/desktop/src/preload.ts
git commit -m "feat(desktop): add sshProbe and sshKillRemoteSession IPC handlers"
```

---

## Task 4: Refactor registry store from environmentId-keyed to identityKey-keyed

**Files:**

- Modify: `apps/web/src/environments/runtime/catalog.ts`
- Modify: `apps/web/src/environments/runtime/service.ts`

This is the biggest refactor. The registry store changes from:

```typescript
byId: Record<EnvironmentId, SavedEnvironmentRecord>;
```

to:

```typescript
byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>;
identityKeyByEnvironmentId: Record<EnvironmentId, RemoteIdentityKey>;
```

**Step 1: Update catalog.ts store**

Refactor `useSavedEnvironmentRegistryStore` (lines 124-165):

- Change store shape to use `byIdentityKey` and `identityKeyByEnvironmentId`
- `upsert()` takes `SavedRemoteEnvironment` and keys by `identityKey`
- When upserting, also update `identityKeyByEnvironmentId` if `environmentId` is set
- `remove()` takes `identityKey` not `environmentId`
- `findByEnvironmentId()` — new helper that looks up via the reverse index
- `markConnected()` takes `identityKey` and updates `lastConnectedAt`
- Keep `listRecords()` returning all entries from `byIdentityKey`
- Persistence: when writing to disk, map `SavedRemoteEnvironment` → `PersistedSavedEnvironmentRecord` for backward compat. When reading, map back.

**Step 2: Update service.ts references**

Every call site that uses `environmentId` to look up registry entries needs to go through the reverse index or use `identityKey` directly:

- `addSavedEnvironment()` → becomes `addOrReconnectSavedEnvironment()` (Task 5)
- `ensureSavedEnvironmentConnection()` — look up by `identityKey` from record
- `syncSavedEnvironmentConnections()` — iterate `byIdentityKey` values
- `removeSavedEnvironment()` — accept `identityKey` instead of `environmentId`
- `disconnectSavedEnvironment()` — still uses `environmentId` for the connection layer (unchanged)
- All `useSavedEnvironmentRegistryStore.getState().upsert()` calls — pass full `SavedRemoteEnvironment`

**Step 3: Add the identity-to-connection bridge maps**

In service.ts, add alongside `environmentConnections`:

```typescript
const identityKeyToEnvironmentId = new Map<RemoteIdentityKey, EnvironmentId>();
```

Update `registerConnection()` and `removeConnection()` to maintain this map.

**Step 4: Run tests**

Run: `bun run --cwd apps/web test`
Expected: Some failures in tests that reference old store shape — fix mock data to match new types.

**Step 5: Fix test mocks**

Update `localApi.test.ts` and `SettingsPanels.browser.tsx` mock data to use the new registry shape.

**Step 6: Run typecheck + tests**

Run: `bun run typecheck && bun run --cwd apps/web test`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/web/src/environments/runtime/catalog.ts apps/web/src/environments/runtime/service.ts apps/web/src/localApi.test.ts apps/web/src/components/settings/SettingsPanels.browser.tsx
git commit -m "refactor: rekey saved environment registry by RemoteIdentityKey"
```

---

## Task 5: Replace addSavedEnvironment with addOrReconnectSavedEnvironment

**Files:**

- Modify: `apps/web/src/environments/runtime/service.ts`
- Modify: `apps/web/src/components/AddRemoteProjectDialog.tsx`

**Step 1: Write addOrReconnectSavedEnvironment()**

Replace `addSavedEnvironment()` (lines 638-698) with:

```typescript
export async function addOrReconnectSavedEnvironment(input: {
  pairingUrl?: string;
  host?: string;
  pairingCode?: string;
  sshConfig?: SshEnvironmentConfig;
  label?: string;
  projectId: string;
}): Promise<{ record: SavedRemoteEnvironment; isReconnect: boolean }> {
  // 1. Resolve pairing target
  const resolvedTarget = await resolveRemotePairingTarget({ ... });

  // 2. Fetch environment descriptor
  const descriptor = await fetchRemoteEnvironmentDescriptor({ ... });
  const environmentId = descriptor.environmentId;

  // 3. Compute identity key
  const identityKey = input.sshConfig
    ? makeRemoteIdentityKey(input.sshConfig)
    : null;

  // 4. Check if this identity already exists
  const existingRecord = identityKey
    ? useSavedEnvironmentRegistryStore.getState().byIdentityKey[identityKey]
    : null;

  // 5. If existing: disconnect old connection if environmentId changed
  if (existingRecord?.environmentId && existingRecord.environmentId !== environmentId) {
    await disconnectSavedEnvironment(existingRecord.environmentId).catch(() => {});
  }

  // 6. Bootstrap bearer session
  const bearerSession = await bootstrapRemoteBearerSession({ ... });

  // 7. Build record (new or updated)
  const record: SavedRemoteEnvironment = {
    identityKey: identityKey!,
    host: input.sshConfig!.host,
    user: input.sshConfig!.user,
    port: input.sshConfig!.port,
    workspaceRoot: input.sshConfig!.workspaceRoot,
    label: input.label || descriptor.label || "",
    createdAt: existingRecord?.createdAt ?? new Date().toISOString(),
    environmentId,
    wsBaseUrl: resolvedTarget.wsBaseUrl,
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    lastConnectedAt: new Date().toISOString(),
    projectId: existingRecord?.projectId ?? input.projectId,
  };

  // 8. Persist
  await persistSavedEnvironmentRecord(record);
  await writeSavedEnvironmentBearerToken(environmentId, bearerSession.sessionToken);

  // 9. Connect
  await ensureSavedEnvironmentConnection(record, {
    bearerToken: bearerSession.sessionToken,
    role: bearerSession.role,
  });

  // 10. Update store
  useSavedEnvironmentRegistryStore.getState().upsert(record);

  return { record, isReconnect: existingRecord !== null && existingRecord !== undefined };
}
```

**Step 2: Update AddRemoteProjectDialog.tsx**

In `handleSubmit()` (around line 282):

- Replace `addSavedEnvironment()` call with `addOrReconnectSavedEnvironment()`
- Check `result.isReconnect` — if true, skip the `project.create` dispatch
- Update status messages accordingly

**Step 3: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/environments/runtime/service.ts apps/web/src/components/AddRemoteProjectDialog.tsx
git commit -m "feat: replace addSavedEnvironment with addOrReconnectSavedEnvironment"
```

---

## Task 6: Implement lazy startup (don't auto-provision on launch)

**Files:**

- Modify: `apps/web/src/environments/runtime/service.ts`

**Step 1: Change syncSavedEnvironmentConnections()**

Currently (lines 550-565) it calls `ensureSavedEnvironmentConnection()` for every saved record on startup. Change to:

- Only populate the registry store (so sidebar shows entries)
- Set runtime state to `disconnected` for all saved remotes
- Do NOT call `ensureSavedEnvironmentConnection()`
- Add a new `connectSavedEnvironment(identityKey)` function that provisions on demand

**Step 2: Add connectSavedEnvironment()**

```typescript
export async function connectSavedEnvironment(identityKey: RemoteIdentityKey): Promise<void> {
  const record = useSavedEnvironmentRegistryStore.getState().byIdentityKey[identityKey];
  if (!record) throw new Error("Unknown remote environment");

  useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId!, {
    connectionState: "connecting",
  });

  try {
    await ensureSavedEnvironmentConnection(record);
  } catch (error) {
    useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId!, {
      connectionState: "error",
      lastError: error instanceof Error ? error.message : String(error),
      lastErrorAt: new Date().toISOString(),
    });
    throw error;
  }
}
```

**Step 3: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS (or fix tests that relied on eager connect)

**Step 4: Commit**

```bash
git add apps/web/src/environments/runtime/service.ts
git commit -m "feat: lazy startup — show saved remotes as disconnected, connect on demand"
```

---

## Task 7: Add cloud connectivity icon to sidebar

**Files:**

- Create: `apps/web/src/components/RemoteConnectionIcon.tsx`
- Create: `apps/web/src/components/__tests__/RemoteConnectionIcon.test.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Write the failing test**

```typescript
// apps/web/src/components/__tests__/RemoteConnectionIcon.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteConnectionIcon } from "../RemoteConnectionIcon";

describe("RemoteConnectionIcon", () => {
  it("renders Cloud with emerald color when connected", () => {
    const markup = renderToStaticMarkup(<RemoteConnectionIcon state="connected" />);
    expect(markup).toContain("text-emerald-500");
  });

  it("renders Cloud with pulse when connecting", () => {
    const markup = renderToStaticMarkup(<RemoteConnectionIcon state="connecting" />);
    expect(markup).toContain("animate-pulse");
  });

  it("renders CloudOff with muted color when disconnected", () => {
    const markup = renderToStaticMarkup(<RemoteConnectionIcon state="disconnected" />);
    expect(markup).toContain("text-muted-foreground");
  });

  it("renders CloudOff with red color when error", () => {
    const markup = renderToStaticMarkup(<RemoteConnectionIcon state="error" />);
    expect(markup).toContain("text-red-500");
  });

  it("renders nothing for local", () => {
    const markup = renderToStaticMarkup(<RemoteConnectionIcon state={null} />);
    expect(markup).toBe("");
  });
});
```

**Step 2: Implement RemoteConnectionIcon**

```typescript
// apps/web/src/components/RemoteConnectionIcon.tsx
import { Cloud, CloudOff } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

type ConnectionState = "connected" | "connecting" | "disconnected" | "error";

interface RemoteConnectionIconProps {
  state: ConnectionState | null;
  tooltip?: string;
  onClick?: () => void;
}

export function RemoteConnectionIcon({ state, tooltip, onClick }: RemoteConnectionIconProps) {
  if (!state) return null;

  const icon = (() => {
    switch (state) {
      case "connected":
        return <Cloud className="size-3.5 text-emerald-500" />;
      case "connecting":
        return <Cloud className="size-3.5 text-muted-foreground animate-pulse" />;
      case "disconnected":
        return <CloudOff className="size-3.5 text-muted-foreground" />;
      case "error":
        return <CloudOff className="size-3.5 text-red-500" />;
    }
  })();

  const clickable = state === "disconnected" || state === "error";

  const element = (
    <button
      type="button"
      className={clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}
      onClick={clickable ? onClick : undefined}
      aria-label={`Remote: ${state}`}
    >
      {icon}
    </button>
  );

  if (!tooltip) return element;

  return (
    <Tooltip>
      <TooltipTrigger delay={300}>{element}</TooltipTrigger>
      <TooltipPopup side="right" sideOffset={4}>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
```

**Step 3: Integrate into Sidebar.tsx**

In the project header rendering (around lines 1731-1748), add `<RemoteConnectionIcon>` before the project title for remote-only projects. Read state from `useSavedEnvironmentRuntimeStore`. Wire `onClick` to `connectSavedEnvironment(identityKey)`.

**Step 4: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/RemoteConnectionIcon.tsx apps/web/src/components/__tests__/RemoteConnectionIcon.test.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add cloud connectivity icon for remote projects in sidebar"
```

---

## Task 8: Add reconnect/disconnect/remove context menu items

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Extend the project context menu**

In `handleProjectButtonContextMenu` (around line 1302), add items for remote projects:

```typescript
const isRemote = project.environmentPresence === "remote-only";
const remoteRuntimeState = isRemote
  ? useSavedEnvironmentRuntimeStore.getState().byId[project.environmentId]
  : null;
const isConnected = remoteRuntimeState?.connectionState === "connected";
const isDisconnected =
  remoteRuntimeState?.connectionState === "disconnected" ||
  remoteRuntimeState?.connectionState === "error";

const menuItems = [
  { id: "copy-path", label: "Copy Project Path" },
  ...(isRemote && isDisconnected ? [{ id: "reconnect", label: "Reconnect" }] : []),
  ...(isRemote && isConnected ? [{ id: "disconnect", label: "Disconnect" }] : []),
  { type: "separator" },
  ...(isRemote ? [{ id: "remove-remote", label: "Remove remote", destructive: true }] : []),
  { id: "delete", label: "Remove project", destructive: true },
];
```

**Step 2: Handle the new menu actions**

After the existing click handlers:

```typescript
if (clicked === "reconnect") {
  const identityKey = findIdentityKeyForProject(project);
  if (identityKey) void connectSavedEnvironment(identityKey);
  return;
}
if (clicked === "disconnect") {
  void disconnectSavedEnvironment(project.environmentId);
  return;
}
if (clicked === "remove-remote") {
  const confirmed = await api.dialogs.confirm(
    `Remove remote "${project.name}"? This will disconnect and delete the saved environment.`,
  );
  if (!confirmed) return;
  const identityKey = findIdentityKeyForProject(project);
  if (identityKey) void removeSavedEnvironment(identityKey);
  return;
}
```

**Step 3: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add reconnect/disconnect/remove context menu for remote projects"
```

---

## Task 9: Add reconnect detection to AddRemoteProjectDialog

**Files:**

- Modify: `apps/web/src/components/AddRemoteProjectDialog.tsx`

**Step 1: Add identity key matching**

As the user types host/user/port/workspace, compute the candidate identity key and check the registry:

```typescript
const candidateIdentityKey = useMemo(() => {
  const h = host.trim();
  const u = user.trim();
  const p = Number(port) || 22;
  const w = workspaceRoot.trim();
  if (!h || !u || !w) return null;
  return makeRemoteIdentityKey({ host: h, user: u, port: p, workspaceRoot: w });
}, [host, user, port, workspaceRoot]);

const existingRemote = useSavedEnvironmentRegistryStore((s) =>
  candidateIdentityKey ? (s.byIdentityKey[candidateIdentityKey] ?? null) : null,
);
const isReconnectMode = existingRemote !== null;
```

**Step 2: Update dialog UI**

- Title: `isReconnectMode ? "Reconnect Remote" : "Add Remote Project"`
- Show banner when `isReconnectMode`: `"This remote is already saved as {existingRemote.label}. Reconnecting will re-establish the tunnel."`
- Submit button: `isReconnectMode ? "Reconnect" : statusMessages[status]`

**Step 3: Update handleSubmit()**

When `isReconnectMode`, skip the `project.create` step (use `existingRemote.projectId` instead).

**Step 4: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/AddRemoteProjectDialog.tsx
git commit -m "feat(web): detect existing remote in dialog and switch to reconnect mode"
```

---

## Task 10: Add Remote Environments settings panel section

**Files:**

- Create: `apps/web/src/components/settings/RemoteEnvironmentsSettings.tsx`
- Create: `apps/web/src/components/settings/__tests__/RemoteEnvironmentsSettings.test.tsx`
- Modify: `apps/web/src/components/settings/SettingsPanels.browser.tsx` or `SettingsPanels.tsx`

**Step 1: Write the component**

Table listing all saved remotes with:

- Label (editable inline)
- Host (`user@host:port workspace`)
- Status (cloud icon + text)
- Last Connected (relative time)
- Actions (Reconnect/Disconnect + Remove)
- "Remove all disconnected" bulk action

**Step 2: Wire into settings panel**

Add a "Remote Environments" tab/section to the existing settings layout. Only show when there are saved remotes.

**Step 3: Write tests**

Test rendering with mock data: empty state, connected remote, disconnected remote, error state.

**Step 4: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/settings/RemoteEnvironmentsSettings.tsx apps/web/src/components/settings/__tests__/RemoteEnvironmentsSettings.test.tsx apps/web/src/components/settings/SettingsPanels.browser.tsx
git commit -m "feat(web): add Remote Environments settings panel"
```

---

## Task 11: Thread click triggers reconnect for disconnected remotes

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Add reconnect-on-thread-click**

In the thread click handler, check if the thread's environment is disconnected. If so, trigger reconnect before navigating:

```typescript
const handleThreadClick = async (threadRef) => {
  const runtimeState = useSavedEnvironmentRuntimeStore.getState().byId[threadRef.environmentId];
  if (
    runtimeState?.connectionState === "disconnected" ||
    runtimeState?.connectionState === "error"
  ) {
    const identityKey = findIdentityKeyForEnvironmentId(threadRef.environmentId);
    if (identityKey) {
      await connectSavedEnvironment(identityKey);
    }
  }
  // Then navigate to thread
  navigate(threadRef);
};
```

**Step 2: Gray out threads for disconnected remotes**

Add `opacity-50` class to thread items whose environment is disconnected.

**Step 3: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): reconnect on thread click for disconnected remotes, gray out threads"
```

---

## Task 12: Persistence migration — backward compatibility

**Files:**

- Modify: `apps/web/src/environments/runtime/catalog.ts`

**Step 1: Write migration in hydration path**

When reading `PersistedSavedEnvironmentRecord[]` from disk, convert to `SavedRemoteEnvironment[]`:

```typescript
function migratePersistedRecord(record: PersistedSavedEnvironmentRecord): SavedRemoteEnvironment {
  const sshConfig = record.sshConfig;
  const identityKey = sshConfig
    ? makeRemoteIdentityKey(sshConfig)
    : makeRemoteIdentityKey({
        host: new URL(record.httpBaseUrl).hostname,
        user: "unknown",
        port: 22,
        workspaceRoot: "/",
      });

  return {
    identityKey,
    host: sshConfig?.host ?? new URL(record.httpBaseUrl).hostname,
    user: sshConfig?.user ?? "unknown",
    port: sshConfig?.port ?? 22,
    workspaceRoot: sshConfig?.workspaceRoot ?? "/",
    label: record.label,
    createdAt: record.createdAt,
    environmentId: record.environmentId,
    wsBaseUrl: record.wsBaseUrl,
    httpBaseUrl: record.httpBaseUrl,
    lastConnectedAt: record.lastConnectedAt,
    projectId: sshConfig?.projectId ?? record.environmentId,
  };
}
```

**Step 2: Write persistence serialization**

When writing to disk, convert `SavedRemoteEnvironment` back to `PersistedSavedEnvironmentRecord` for backward compat with older app versions.

**Step 3: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/environments/runtime/catalog.ts
git commit -m "feat: add persistence migration for identity-keyed saved environments"
```

---

## Task 13: Integration test — full lifecycle

**Files:**

- Create: `apps/web/src/environments/runtime/__tests__/remoteLifecycle.test.ts`

**Step 1: Write integration tests covering:**

1. Add new remote → creates entry with identityKey
2. Add same remote again → reconnects (no duplicate, no error)
3. Disconnect → state becomes disconnected, entry persists
4. Reconnect → state becomes connected, URLs updated
5. Remove → entry deleted, connection disposed
6. Startup with saved remotes → all show as disconnected (lazy)
7. Identity key changes when workspace changes (same host, different path)

**Step 2: Run tests**

Run: `bun run --cwd apps/web test`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/environments/runtime/__tests__/remoteLifecycle.test.ts
git commit -m "test: add integration tests for remote environment lifecycle"
```

---

## Task 14: Final cleanup and typecheck

**Files:**

- Remove dead code from old `addSavedEnvironment()` callers
- Remove `bunfig.toml` from project root if still present
- Clean up `.claude/worktrees/` submodule entries from git

**Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 2: Full test suite**

Run: `bun run --cwd apps/web test && bun run --cwd packages/shared test && bun run --cwd apps/server test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: cleanup dead code and stale artifacts from lifecycle refactor"
```
