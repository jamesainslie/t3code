# SSH Remote Connection UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix a version mismatch bug causing unnecessary 102MB binary transfers on every SSH connection, add saved SSH host profiles with a picker in the connection dialog, and replace the bare status text with a rich provisioning progress timeline.

**Architecture:** Task 3 (bug fix) lands first as the smallest, safest change -- it adds a `normalizeVersion` helper to `packages/shared/src/ssh.ts` and changes the desktop SSH manager to pass the server package version instead of the Electron app version. Task 1 (saved hosts) evolves the existing `recent-remote-hosts.json` persistence into a `saved-ssh-hosts.json` system with `id` and `label` fields, exposes CRUD via the desktop bridge IPC, and adds a Select combobox to the Add Remote Project dialog. Task 2 (rich progress) extends the `DesktopSshStatusUpdate` contract with structured log events, makes `provision.ts` emit granular phase/log/progress events, and replaces the dialog's status text with a vertical stepper timeline.

**Tech Stack:** TypeScript, Vitest, Effect Schema, Electron IPC, React 19, Zustand, @base-ui/react (Select, Combobox), Tailwind CSS, lucide-react, tsdown

---

## Dependency Graph

```
Task 3 (version fix) ── independent, ship first
Task 1 (saved hosts) ── independent of Task 3, depends on nothing
Task 2 (rich progress) ── independent of Task 1, depends on nothing

Within each task, steps are sequential (TDD: test → red → green → commit).
```

---

## Task 3: Fix Version Mismatch Bug

The version comparison at `packages/shared/src/provision.ts:163` compares the Electron app version (e.g. `"40.6.0"`) against the remote probe output (e.g. `"t3 v0.0.17"`). These can never match, so the 102MB server binary is re-uploaded on every cold connection.

**Root cause:** `apps/desktop/src/main.ts:1710` passes `app.getVersion()` (Electron version from `apps/desktop/package.json` -- currently `"0.0.17"` but this is coincidental and fragile) as `localVersion`, while the remote probe runs `$HOME/.t3/bin/t3 --version` which outputs `"t3 v0.0.17"` (the Effect CLI framework prepends the program name and "v" prefix). Even when the raw version numbers match, the string comparison fails because of the `"t3 v"` prefix.

**Fix approach:**

1. Add a `normalizeVersion()` pure function to `packages/shared/src/ssh.ts` that strips the `"t3 v"` or `"t3 "` prefix and trims whitespace.
2. Use `normalizeVersion()` in `provision.ts` when comparing `probe.currentVersion` against `localVersion`.
3. Change `apps/desktop/src/sshManager.ts` to import the server package version from `apps/server/package.json` (resolved at bundle time by tsdown) instead of receiving it as a parameter.

**Files:**

- Modify: `packages/shared/src/ssh.ts` (add `normalizeVersion`)
- Modify: `packages/shared/src/ssh.test.ts` (add tests for `normalizeVersion`)
- Modify: `packages/shared/src/provision.ts:163` (use `normalizeVersion` in comparison)
- Modify: `apps/desktop/src/sshManager.ts` (import server version from package.json)
- Modify: `apps/desktop/src/main.ts:1710` (remove `localVersion: app.getVersion()`)

### Step 1: Write the failing test for `normalizeVersion`

Add to `packages/shared/src/ssh.test.ts`:

```typescript
describe("normalizeVersion", () => {
  it("strips 't3 v' prefix from remote version", () => {
    expect(normalizeVersion("t3 v0.0.17")).toBe("0.0.17");
  });

  it("strips 't3 ' prefix without v", () => {
    expect(normalizeVersion("t3 0.0.17")).toBe("0.0.17");
  });

  it("returns bare version unchanged", () => {
    expect(normalizeVersion("0.0.17")).toBe("0.0.17");
  });

  it("trims whitespace", () => {
    expect(normalizeVersion("  t3 v0.0.17  ")).toBe("0.0.17");
  });

  it("handles empty string", () => {
    expect(normalizeVersion("")).toBe("");
  });
});
```

Update the import at the top of the test file to include `normalizeVersion`.

### Step 2: Run test to verify it fails

Run: `cd /Volumes/Code/t3code && npx vitest run packages/shared/src/ssh.test.ts`
Expected: FAIL -- `normalizeVersion` is not exported from `./ssh`

### Step 3: Implement `normalizeVersion` in `packages/shared/src/ssh.ts`

Add at the bottom of the "Pure helpers" or "Types" section:

```typescript
/**
 * Normalize a version string by stripping the "t3 v" or "t3 " prefix
 * that the Effect CLI framework prepends to `--version` output.
 *
 * Examples:
 *   "t3 v0.0.17" → "0.0.17"
 *   "0.0.17"     → "0.0.17"
 *   ""           → ""
 */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^t3\s+v?/i, "");
}
```

### Step 4: Run test to verify it passes

Run: `cd /Volumes/Code/t3code && npx vitest run packages/shared/src/ssh.test.ts`
Expected: ALL PASS

### Step 5: Update `provision.ts` to use `normalizeVersion`

In `packages/shared/src/provision.ts`, add `normalizeVersion` to the import from `./ssh.js`:

```typescript
import {
  // ...existing imports...
  normalizeVersion,
  type SshTarget,
} from "./ssh.js";
```

Then change line 163 from:

```typescript
  if (!sessionExists && probe.currentVersion !== localVersion) {
```

to:

```typescript
  if (!sessionExists && normalizeVersion(probe.currentVersion) !== normalizeVersion(localVersion)) {
```

Also update the log message on the next line to show normalized versions for clarity:

```typescript
log(
  `phase 3: version mismatch (remote=${normalizeVersion(probe.currentVersion) || "none"}, local=${normalizeVersion(localVersion)}), transferring binaries...`,
);
```

And update the version-match log (around line 182):

```typescript
log(`phase 3: version match (${normalizeVersion(localVersion)}), skipping binary transfer`);
```

### Step 6: Change `apps/desktop/src/sshManager.ts` to use server package version

At the top of `apps/desktop/src/sshManager.ts`, add a JSON import for the server version:

```typescript
import serverPackageJson from "../../../apps/server/package.json" with { type: "json" };
```

Note: tsdown bundles `@t3tools/*` via `noExternal`, but this relative import to `apps/server/package.json` will also be resolved at bundle time since tsdown resolves all imports. The `resolveJsonModule: true` in tsconfig.base.json supports this.

Update the `SshConnectOptions` interface to remove the `localVersion` field:

```typescript
export interface SshConnectOptions {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  // localVersion removed -- derived from server package.json at build time
  onStatus: (phase: "provisioning" | "starting" | "connected") => void;
  onLog?: ((line: string) => void) | undefined;
}
```

Update the `sshConnect` function to use the imported version:

```typescript
export async function sshConnect(opts: SshConnectOptions): Promise<SshConnectResult> {
  const binDir = resolveSshBinariesDir();
  const result = await provision({
    target: { host: opts.host, user: opts.user, port: opts.port },
    projectId: opts.projectId,
    workspaceRoot: opts.workspaceRoot,
    localVersion: serverPackageJson.version,
    // ...rest unchanged
```

### Step 7: Update `apps/desktop/src/main.ts` to remove `localVersion`

In `apps/desktop/src/main.ts` around line 1708-1710, remove the `localVersion` property from the `sshConnect` call:

```typescript
      return sshConnect({
        ...opts,
        // localVersion removed -- sshManager.ts reads from server package.json
        onStatus: (phase) => {
```

### Step 8: Run full test suite to verify nothing breaks

Run: `cd /Volumes/Code/t3code && npx vitest run packages/shared/src/ssh.test.ts packages/shared/src/sshManager.test.ts apps/desktop/src/`
Expected: ALL PASS

### Step 9: Typecheck

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: No errors

### Step 10: Commit

```bash
git add packages/shared/src/ssh.ts packages/shared/src/ssh.test.ts packages/shared/src/provision.ts apps/desktop/src/sshManager.ts apps/desktop/src/main.ts
git commit -m "fix: use server package version for SSH binary version comparison

The version comparison in provision.ts was comparing the Electron app
version against the 't3 v0.0.17' string from the remote probe, which
could never match. This caused the 102MB server binary to be re-uploaded
on every cold SSH connection.

- Add normalizeVersion() to strip 't3 v' prefix from remote probe output
- Import server package.json version at build time in desktop sshManager
- Remove localVersion parameter threading through main.ts"
```

---

## Task 1: Saved SSH Hosts in Settings + Host Picker in Dialog

Evolve the existing `recent-remote-hosts.json` system into a `saved-ssh-hosts.json` persistence layer with `id` and `label` fields. Expose CRUD via new IPC bridge methods. Add a Select dropdown to the Add Remote Project dialog.

### Subtask 1A: Define the `SavedSshHost` type and bridge methods in contracts

**Files:**

- Modify: `packages/contracts/src/ipc.ts`

#### Step 1: Add the `SavedSshHost` interface and bridge methods

In `packages/contracts/src/ipc.ts`, add the new type after `SshEnvironmentConfig`:

```typescript
export interface SavedSshHost {
  id: string;
  label: string;
  host: string;
  user: string;
  port: number;
}
```

Add three new methods to the `DesktopBridge` interface (after `recordRemoteHost`):

```typescript
getSavedSshHosts: () => Promise<readonly SavedSshHost[]>;
upsertSavedSshHost: (host: SavedSshHost) => Promise<void>;
removeSavedSshHost: (id: string) => Promise<void>;
```

#### Step 2: Typecheck

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p packages/contracts/tsconfig.json`
Expected: PASS (the interface is just extended -- downstream consumers will fail typecheck until they implement the new methods, which is expected and addressed in subsequent steps)

#### Step 3: Commit

```bash
git add packages/contracts/src/ipc.ts
git commit -m "feat: add SavedSshHost type and bridge methods to contracts"
```

---

### Subtask 1B: Implement persistence and IPC handlers on the desktop side

**Files:**

- Modify: `apps/desktop/src/main.ts` (add IPC handlers, refactor recent hosts into saved hosts)
- Modify: `apps/desktop/src/preload.ts` (expose new methods)

#### Step 1: Add saved SSH hosts persistence functions to `apps/desktop/src/main.ts`

Add three new IPC channel constants alongside the existing SSH channels (around line 106):

```typescript
const SSH_GET_SAVED_HOSTS_CHANNEL = "desktop:ssh-get-saved-hosts";
const SSH_UPSERT_SAVED_HOST_CHANNEL = "desktop:ssh-upsert-saved-host";
const SSH_REMOVE_SAVED_HOST_CHANNEL = "desktop:ssh-remove-saved-host";
```

Add a new path constant (near `SAVED_ENVIRONMENT_REGISTRY_PATH` around line 112):

```typescript
const SAVED_SSH_HOSTS_PATH = Path.join(STATE_DIR, "saved-ssh-hosts.json");
```

Replace the `RecentRemoteHost` interface and its functions (lines 1384-1429) with a `SavedSshHost`-compatible system. Keep `recordRecentRemoteHost` as a thin wrapper that upserts into saved hosts:

```typescript
interface SavedSshHostRecord {
  id: string;
  label: string;
  host: string;
  user: string;
  port: number;
}

function readSavedSshHosts(): SavedSshHostRecord[] {
  try {
    if (!FS.existsSync(SAVED_SSH_HOSTS_PATH)) return [];
    const raw = FS.readFileSync(SAVED_SSH_HOSTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedSshHostRecord =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).id === "string" &&
        typeof (entry as Record<string, unknown>).label === "string" &&
        typeof (entry as Record<string, unknown>).host === "string" &&
        typeof (entry as Record<string, unknown>).user === "string" &&
        typeof (entry as Record<string, unknown>).port === "number",
    );
  } catch {
    return [];
  }
}

function writeSavedSshHosts(hosts: SavedSshHostRecord[]): void {
  try {
    const directory = Path.dirname(SAVED_SSH_HOSTS_PATH);
    FS.mkdirSync(directory, { recursive: true });
    FS.writeFileSync(SAVED_SSH_HOSTS_PATH, JSON.stringify(hosts, null, 2), "utf8");
  } catch (error) {
    console.warn("[desktop] failed to write saved SSH hosts", error);
  }
}

function upsertSavedSshHost(host: SavedSshHostRecord): void {
  const existing = readSavedSshHosts();
  const filtered = existing.filter((h) => h.id !== host.id);
  writeSavedSshHosts([host, ...filtered]);
}

function removeSavedSshHost(id: string): void {
  const existing = readSavedSshHosts();
  writeSavedSshHosts(existing.filter((h) => h.id !== id));
}

/** Backward-compat: auto-save a host when recordRemoteHost is called */
function recordRecentRemoteHost(entry: { host: string; user: string; port: number }): void {
  const existing = readSavedSshHosts();
  const duplicate = existing.find(
    (h) => h.host === entry.host && h.user === entry.user && h.port === entry.port,
  );
  if (duplicate) {
    // Move to front
    upsertSavedSshHost(duplicate);
    return;
  }
  upsertSavedSshHost({
    id: crypto.randomUUID(),
    label: `${entry.user}@${entry.host}`,
    host: entry.host,
    user: entry.user,
    port: entry.port,
  });
}
```

Add three IPC handlers in the `registerIpcHandlers` function (after the `SSH_RECORD_HOST_CHANNEL` handler, around line 1747):

```typescript
ipcMain.removeHandler(SSH_GET_SAVED_HOSTS_CHANNEL);
ipcMain.handle(SSH_GET_SAVED_HOSTS_CHANNEL, async () => {
  return readSavedSshHosts();
});

ipcMain.removeHandler(SSH_UPSERT_SAVED_HOST_CHANNEL);
ipcMain.handle(SSH_UPSERT_SAVED_HOST_CHANNEL, async (_event, host: SavedSshHostRecord) => {
  if (
    typeof host?.id === "string" &&
    typeof host.label === "string" &&
    typeof host.host === "string" &&
    typeof host.user === "string" &&
    typeof host.port === "number"
  ) {
    upsertSavedSshHost(host);
  }
});

ipcMain.removeHandler(SSH_REMOVE_SAVED_HOST_CHANNEL);
ipcMain.handle(SSH_REMOVE_SAVED_HOST_CHANNEL, async (_event, id: string) => {
  if (typeof id === "string") {
    removeSavedSshHost(id);
  }
});
```

#### Step 2: Expose new methods in `apps/desktop/src/preload.ts`

Add three channel constants:

```typescript
const SSH_GET_SAVED_HOSTS_CHANNEL = "desktop:ssh-get-saved-hosts";
const SSH_UPSERT_SAVED_HOST_CHANNEL = "desktop:ssh-upsert-saved-host";
const SSH_REMOVE_SAVED_HOST_CHANNEL = "desktop:ssh-remove-saved-host";
```

Add three methods to the `contextBridge.exposeInMainWorld` object (after `recordRemoteHost`):

```typescript
  getSavedSshHosts: () => ipcRenderer.invoke(SSH_GET_SAVED_HOSTS_CHANNEL),
  upsertSavedSshHost: (host) => ipcRenderer.invoke(SSH_UPSERT_SAVED_HOST_CHANNEL, host),
  removeSavedSshHost: (id: string) => ipcRenderer.invoke(SSH_REMOVE_SAVED_HOST_CHANNEL, id),
```

Also import `SavedSshHost` from contracts (it will be used for typing, though the `satisfies DesktopBridge` at the end ensures correctness).

#### Step 3: Typecheck

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

#### Step 4: Commit

```bash
git add apps/desktop/src/main.ts apps/desktop/src/preload.ts
git commit -m "feat: implement saved SSH hosts IPC persistence on desktop side

Evolves the recent-remote-hosts.json system into saved-ssh-hosts.json
with id, label, host, user, port fields. Adds getSavedSshHosts,
upsertSavedSshHost, and removeSavedSshHost IPC handlers. The existing
recordRemoteHost call auto-saves hosts for backward compatibility."
```

---

### Subtask 1C: Add saved host picker to the Add Remote Project dialog

**Files:**

- Modify: `apps/web/src/components/AddRemoteProjectDialog.tsx`

#### Step 1: Add the host picker Select to the dialog

Replace the contents of `AddRemoteProjectDialog.tsx` with an enhanced version that includes a saved host picker. The key changes:

1. Add state for `savedHosts` and `selectedHostId`.
2. On mount (when `open` becomes true), call `window.desktopBridge.getSavedSshHosts()` to load saved hosts.
3. Add a `<Select>` (from `@base-ui/react`) at the top of the form: "Select a saved host" or "Enter new host".
4. When a saved host is selected, auto-fill `host`, `user`, `port` fields.
5. Add a "Save this host" checkbox that appears when using a new (unsaved) host.
6. After successful connection, if "save" is checked, call `upsertSavedSshHost`.

```typescript
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import type { SavedSshHost } from "@t3tools/contracts";
import { newCommandId, newProjectId } from "../lib/utils";
import { readEnvironmentApi } from "../environmentApi";
import { addSavedEnvironment } from "../environments/runtime/service";
import { isElectron } from "../env";
import {
  Select,
  SelectButton,
  SelectOption,
  SelectOptionIndicator,
  SelectPopup,
  SelectValue,
} from "./ui/select";

type Status = "idle" | "provisioning" | "registering" | "creating-project";

const NEW_HOST_SENTINEL = "__new__";

interface AddRemoteProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddRemoteProjectDialog({ open, onClose }: AddRemoteProjectDialogProps) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [savedHosts, setSavedHosts] = useState<readonly SavedSshHost[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>(NEW_HOST_SENTINEL);
  const [saveHost, setSaveHost] = useState(false);

  const resetForm = useCallback(() => {
    setHost("");
    setUser("");
    setPort("22");
    setWorkspaceRoot("");
    setLabel("");
    setError(null);
    setStatus("idle");
    setSelectedHostId(NEW_HOST_SENTINEL);
    setSaveHost(false);
  }, []);

  // Load saved hosts when dialog opens
  useEffect(() => {
    if (open && isElectron && window.desktopBridge) {
      void window.desktopBridge.getSavedSshHosts().then((hosts) => {
        setSavedHosts(hosts);
      });
    }
  }, [open]);

  if (!open) return null;

  function handleHostSelect(value: string) {
    setSelectedHostId(value);
    if (value === NEW_HOST_SENTINEL) {
      setHost("");
      setUser("");
      setPort("22");
      return;
    }
    const selected = savedHosts.find((h) => h.id === value);
    if (selected) {
      setHost(selected.host);
      setUser(selected.user);
      setPort(String(selected.port));
      if (!label.trim()) {
        setLabel(selected.label);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isElectron || !window.desktopBridge) {
      setError("Remote SSH projects require the desktop app.");
      return;
    }

    const projectId = newProjectId();
    const trimmedLabel = label.trim();
    const displayLabel = trimmedLabel || `${user.trim()}@${host.trim()}`;

    try {
      setStatus("provisioning");
      const sshResult = await window.desktopBridge.sshConnect({
        projectId,
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
        workspaceRoot: workspaceRoot.trim(),
      });

      if (!sshResult.pairingUrl) {
        throw new Error(
          "Remote server did not provide a pairing URL. The server may be too old — ensure the remote binary matches the local version.",
        );
      }

      setStatus("registering");
      const record = await addSavedEnvironment({
        label: displayLabel,
        pairingUrl: sshResult.pairingUrl,
        sshConfig: {
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
          projectId,
          workspaceRoot: workspaceRoot.trim(),
        },
      });

      setStatus("creating-project");
      const remoteApi = readEnvironmentApi(record.environmentId);
      if (!remoteApi) {
        throw new Error("Failed to connect to the remote environment after registration.");
      }

      await remoteApi.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: displayLabel,
        workspaceRoot: workspaceRoot.trim(),
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        createdAt: new Date().toISOString(),
      });

      // Save host if requested (new host) or update recency (existing host)
      if (saveHost && selectedHostId === NEW_HOST_SENTINEL) {
        await window.desktopBridge.upsertSavedSshHost({
          id: crypto.randomUUID(),
          label: displayLabel,
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
        });
      }

      await window.desktopBridge.recordRemoteHost({
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
      });

      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  const statusMessages: Record<Status, string> = {
    idle: "Add Remote Project",
    provisioning: "Provisioning SSH tunnel...",
    registering: "Registering remote environment...",
    "creating-project": "Creating project on remote...",
  };

  const isSubmitting = status !== "idle";
  const isNewHost = selectedHostId === NEW_HOST_SENTINEL;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-2xl">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Add Remote Project</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          {savedHosts.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">SSH Host</span>
              <Select
                value={selectedHostId}
                onValueChange={(value) => handleHostSelect(value as string)}
                disabled={isSubmitting}
              >
                <SelectButton size="sm">
                  <SelectValue placeholder="Select a saved host..." />
                </SelectButton>
                <SelectPopup>
                  <SelectOption value={NEW_HOST_SENTINEL}>
                    <SelectOptionIndicator />
                    Enter new host...
                  </SelectOption>
                  {savedHosts.map((h) => (
                    <SelectOption key={h.id} value={h.id}>
                      <SelectOptionIndicator />
                      <span className="truncate">
                        {h.label}{" "}
                        <span className="text-muted-foreground">
                          ({h.user}@{h.host}:{h.port})
                        </span>
                      </span>
                    </SelectOption>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Host</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="devbox or 192.168.1.10"
              required
              disabled={isSubmitting || !isNewHost}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">User</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="james"
              required
              disabled={isSubmitting || !isNewHost}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Port</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
              type="number"
              min={1}
              max={65535}
              disabled={isSubmitting || !isNewHost}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Remote workspace path
            </span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="/home/james/myapp"
              required
              disabled={isSubmitting}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Label (optional)</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Dev Server"
              disabled={isSubmitting}
            />
          </label>
          {isNewHost && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveHost}
                onChange={(e) => setSaveHost(e.target.checked)}
                disabled={isSubmitting}
                className="size-3.5 rounded border-border accent-primary"
              />
              <span className="text-[11px] text-muted-foreground">Save this host for later</span>
            </label>
          )}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) {
                  resetForm();
                  onClose();
                }
              }}
              disabled={isSubmitting}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {statusMessages[status]}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
```

Note: The exact Select component API should match what is already used in the codebase. Check `apps/web/src/components/ui/select.tsx` for the exported component names. The above uses the base-ui Select pattern already present in the project.

#### Step 2: Verify the Select import paths are correct

Inspect the Select exports from `apps/web/src/components/ui/select.tsx` and adjust the imports accordingly. The file exports `Select`, `SelectButton`, `SelectOption`, `SelectOptionIndicator`, `SelectPopup`, `SelectValue` (or similar -- match the actual exports).

#### Step 3: Typecheck

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: PASS

#### Step 4: Manually test in dev mode

Run: `cd /Volumes/Code/t3code && bun run dev` (or however the monorepo dev server starts)

- Open the app, click "Add Remote Project"
- If no saved hosts exist, the Select should not appear (only manual inputs)
- Fill in host details, check "Save this host", submit
- Reopen dialog -- the Select should appear with the saved host
- Select it -- host/user/port should auto-fill and become read-only

#### Step 5: Commit

```bash
git add apps/web/src/components/AddRemoteProjectDialog.tsx
git commit -m "feat: add saved SSH host picker to Add Remote Project dialog

Shows a Select dropdown when saved hosts exist. Selecting a host
auto-fills host/user/port fields (read-only). New hosts can optionally
be saved via a checkbox. Falls back to manual entry when no hosts
are saved."
```

---

### Subtask 1D: (Optional) Add SSH host management to Settings

This subtask adds a "Saved SSH Hosts" section to the Connections settings page. It is optional but recommended for users who want to manage (rename, delete) saved hosts outside the dialog.

**Files:**

- Modify: `apps/web/src/components/settings/ConnectionsSettings.tsx`

#### Step 1: Add a "Saved SSH Hosts" section

Add a new `SettingsSection` titled "SSH Hosts" at the bottom of the ConnectionsSettings component. It should:

- Load hosts via `window.desktopBridge.getSavedSshHosts()` on mount
- Display each host as a `SettingsRow` showing label, host:port, user
- Add a "Remove" button per host (calls `removeSavedSshHost`)
- Add a "+" button in the section header to add a new host (opens a small inline form)

This follows the same patterns as the existing "Saved Environments" section in the same file.

#### Step 2: Typecheck and manual test

#### Step 3: Commit

```bash
git add apps/web/src/components/settings/ConnectionsSettings.tsx
git commit -m "feat: add SSH host management UI to Connections settings"
```

---

## Task 2: Rich Progress Log During SSH Provisioning

Replace the simple `"provisioning" | "starting" | "connected"` status with structured events that power a visual timeline in the dialog.

### Subtask 2A: Extend the status event types in contracts

**Files:**

- Modify: `packages/contracts/src/ipc.ts`

#### Step 1: Define structured status event types

Replace the simple `DesktopSshStatusUpdate` interface with a richer one:

```typescript
export type SshProvisionEventType = "phase-start" | "phase-complete" | "phase-error" | "log";

export interface SshProvisionPhase {
  /** 1-based phase number */
  index: number;
  /** Human-readable label, e.g. "Establishing SSH connection" */
  label: string;
  /** Total number of phases (currently 5) */
  total: number;
}

export interface DesktopSshStatusUpdate {
  projectId: string;
  /** Legacy field -- kept for backward compat with remoteConnectionStore */
  phase: string;
  /** Structured event (absent for legacy callers) */
  event?: {
    type: SshProvisionEventType;
    phase: SshProvisionPhase;
    message?: string;
    timestamp: number;
  };
}
```

This is backward compatible -- `phase` remains a string, and `event` is optional. New consumers read `event`, old consumers still work.

#### Step 2: Commit

```bash
git add packages/contracts/src/ipc.ts
git commit -m "feat: extend DesktopSshStatusUpdate with structured provision events"
```

---

### Subtask 2B: Emit structured events from `provision.ts`

**Files:**

- Modify: `packages/shared/src/provision.ts`

#### Step 1: Extend `ProvisionOptions.onStatus` to accept structured events

Update the `onStatus` callback type in `ProvisionOptions`:

```typescript
export interface ProvisionStatusEvent {
  type: "phase-start" | "phase-complete" | "phase-error" | "log";
  phaseIndex: number;
  phaseLabel: string;
  phaseTotal: number;
  message?: string;
  timestamp: number;
}

export interface ProvisionOptions {
  // ...existing fields...
  /** Optional progress callback (legacy 3-phase) */
  onStatus?: (phase: "provisioning" | "starting" | "connected") => void;
  /** Optional structured progress callback */
  onProvisionEvent?: (event: ProvisionStatusEvent) => void;
  // ...rest unchanged...
}
```

#### Step 2: Add a helper to emit structured events

Inside `provision.ts`, add a helper used throughout the function:

```typescript
function emitEvent(
  opts: Pick<ProvisionOptions, "onProvisionEvent">,
  type: ProvisionStatusEvent["type"],
  phaseIndex: number,
  phaseLabel: string,
  message?: string,
): void {
  opts.onProvisionEvent?.({
    type,
    phaseIndex,
    phaseLabel,
    phaseTotal: 5,
    message,
    timestamp: Date.now(),
  });
}
```

#### Step 3: Instrument each phase with structured events

Add `emitEvent` calls throughout the `provision` function. For example:

Phase 1 (SSH master):

```typescript
emitEvent(opts, "phase-start", 1, "Establishing SSH connection");
await opts.sshManager.getOrCreate(target);
emitEvent(opts, "phase-complete", 1, "Establishing SSH connection", "SSH master ready");
```

Phase 2 (probe):

```typescript
emitEvent(opts, "phase-start", 2, "Probing remote environment");
// ...existing probe code...
emitEvent(
  opts,
  "phase-complete",
  2,
  "Probing remote environment",
  `${probe.os}/${probe.arch}, version=${normalizeVersion(probe.currentVersion) || "none"}`,
);
```

Phase 3 (binary transfer):

```typescript
emitEvent(opts, "phase-start", 3, "Checking server binaries");
// ...existing code...
if (!sessionExists && normalizeVersion(probe.currentVersion) !== normalizeVersion(localVersion)) {
  emitEvent(opts, "log", 3, "Checking server binaries", "Version mismatch — uploading binaries...");
  // ...scp calls...
  emitEvent(opts, "log", 3, "Checking server binaries", "Uploading server binary...");
  await scpFile(target, serverBin, `${t3Home}/bin/t3`);
  emitEvent(opts, "log", 3, "Checking server binaries", "Uploading tmux binary...");
  await scpFile(target, tmuxBin, `${t3Home}/bin/tmux`);
  // ...chmod...
  emitEvent(opts, "phase-complete", 3, "Checking server binaries", "Binaries installed");
} else {
  emitEvent(
    opts,
    "phase-complete",
    3,
    "Checking server binaries",
    sessionExists ? "Session exists, skipping" : "Version match, skipping",
  );
}
```

Phase 4 (tmux/server start):

```typescript
emitEvent(opts, "phase-start", 4, "Starting remote server");
// ...existing code...
emitEvent(
  opts,
  "phase-complete",
  4,
  "Starting remote server",
  `Server running on port ${remotePort}`,
);
```

Phase 5 (port forward):

```typescript
emitEvent(opts, "phase-start", 5, "Setting up SSH tunnel");
// ...existing code...
emitEvent(
  opts,
  "phase-complete",
  5,
  "Setting up SSH tunnel",
  `localhost:${localPort} → remote:${remotePort}`,
);
```

Also wrap the remote log tail lines as structured log events. In `coldStart`, when the `onLog` callback fires, also emit structured events:

In the `provision` function, pass through a wrapped `onLog` that also emits structured events:

```typescript
const wrappedOnLog = opts.onLog
  ? (line: string) => {
      opts.onLog!(line);
      emitEvent(opts, "log", 4, "Starting remote server", line);
    }
  : undefined;
remotePort = await coldStart(target, projectId, workspaceRoot, wrappedOnLog);
```

#### Step 4: Run existing tests

Run: `cd /Volumes/Code/t3code && npx vitest run packages/shared/`
Expected: ALL PASS (the `onProvisionEvent` callback is optional, so existing tests/code are unaffected)

#### Step 5: Commit

```bash
git add packages/shared/src/provision.ts
git commit -m "feat: emit structured provision events from SSH provisioner

Adds onProvisionEvent callback to ProvisionOptions that emits
phase-start, phase-complete, phase-error, and log events for each
of the 5 provisioning phases. The legacy onStatus callback remains
for backward compatibility."
```

---

### Subtask 2C: Forward structured events through desktop IPC

**Files:**

- Modify: `apps/desktop/src/sshManager.ts` (add `onProvisionEvent` to options)
- Modify: `apps/desktop/src/main.ts` (forward structured events via IPC)

#### Step 1: Thread `onProvisionEvent` through `SshConnectOptions`

In `apps/desktop/src/sshManager.ts`, add to `SshConnectOptions`:

```typescript
export interface SshConnectOptions {
  // ...existing fields...
  onProvisionEvent?:
    | ((event: import("@t3tools/shared/provision").ProvisionStatusEvent) => void)
    | undefined;
}
```

Pass it through to `provision()`:

```typescript
    ...(opts.onProvisionEvent != null ? { onProvisionEvent: opts.onProvisionEvent } : {}),
```

#### Step 2: Forward from `main.ts` IPC handler

In `apps/desktop/src/main.ts`, update the SSH_CONNECT_CHANNEL handler to forward structured events:

```typescript
return sshConnect({
  ...opts,
  onStatus: (phase) => {
    mainWindow?.webContents.send(SSH_STATUS_UPDATE_CHANNEL, {
      projectId: opts.projectId,
      phase,
    } satisfies DesktopSshStatusUpdate);
  },
  onProvisionEvent: (event) => {
    mainWindow?.webContents.send(SSH_STATUS_UPDATE_CHANNEL, {
      projectId: opts.projectId,
      phase: event.type === "phase-start" ? event.phaseLabel : event.phaseLabel,
      event: {
        type: event.type,
        phase: {
          index: event.phaseIndex,
          label: event.phaseLabel,
          total: event.phaseTotal,
        },
        message: event.message,
        timestamp: event.timestamp,
      },
    } satisfies DesktopSshStatusUpdate);
  },
  onLog: (line) => {
    console.log(`[ssh-remote-log] ${opts.host}: ${line}`);
  },
});
```

#### Step 3: Typecheck

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

#### Step 4: Commit

```bash
git add apps/desktop/src/sshManager.ts apps/desktop/src/main.ts
git commit -m "feat: forward structured SSH provision events through desktop IPC"
```

---

### Subtask 2D: Store structured events in the web store

**Files:**

- Modify: `apps/web/src/remoteConnectionStore.ts`

#### Step 1: Extend the store to hold structured provision events

```typescript
import { create } from "zustand";
import type { RemoteConnectionStatus, DesktopSshStatusUpdate } from "@t3tools/contracts";

export interface ProvisionStep {
  index: number;
  label: string;
  total: number;
  status: "pending" | "active" | "complete" | "error";
  logs: Array<{ message: string; timestamp: number }>;
}

interface RemoteConnectionEntry {
  projectId: string;
  status: RemoteConnectionStatus;
  wsUrl?: string;
  error?: string;
  phase?: string;
  /** Structured provisioning steps (populated when structured events are received) */
  steps: ProvisionStep[];
}

interface RemoteConnectionStore {
  connections: Record<string, RemoteConnectionEntry>;
  setStatus(
    projectId: string,
    status: RemoteConnectionStatus,
    extra?: Partial<Pick<RemoteConnectionEntry, "wsUrl" | "error">>,
  ): void;
  setPhase(projectId: string, phase: string): void;
  handleProvisionEvent(update: DesktopSshStatusUpdate): void;
  getStatus(projectId: string): RemoteConnectionStatus;
  getEntry(projectId: string): RemoteConnectionEntry | undefined;
  getWsUrl(projectId: string): string | undefined;
  clearConnection(projectId: string): void;
}

export const useRemoteConnectionStore = create<RemoteConnectionStore>((set, get) => ({
  connections: {},

  // ...existing methods unchanged...

  handleProvisionEvent(update) {
    const { projectId, event } = update;
    if (!event) {
      // Legacy event -- just update phase
      get().setPhase(projectId, update.phase);
      return;
    }

    set((state) => {
      const existing = state.connections[projectId] ?? {
        projectId,
        status: "provisioning" as RemoteConnectionStatus,
        steps: [],
      };

      const steps = [...existing.steps];

      // Ensure all steps up to this index exist
      for (let i = steps.length; i < event.phase.index; i++) {
        steps.push({
          index: i + 1,
          label: i + 1 === event.phase.index ? event.phase.label : `Phase ${i + 1}`,
          total: event.phase.total,
          status: "pending",
          logs: [],
        });
      }

      const stepIdx = event.phase.index - 1;
      const step = steps[stepIdx] ?? {
        index: event.phase.index,
        label: event.phase.label,
        total: event.phase.total,
        status: "pending",
        logs: [],
      };

      switch (event.type) {
        case "phase-start":
          step.status = "active";
          step.label = event.phase.label;
          break;
        case "phase-complete":
          step.status = "complete";
          if (event.message) {
            step.logs = [...step.logs, { message: event.message, timestamp: event.timestamp }];
          }
          break;
        case "phase-error":
          step.status = "error";
          if (event.message) {
            step.logs = [...step.logs, { message: event.message, timestamp: event.timestamp }];
          }
          break;
        case "log":
          if (event.message) {
            step.logs = [...step.logs, { message: event.message, timestamp: event.timestamp }];
          }
          break;
      }

      steps[stepIdx] = { ...step };

      return {
        connections: {
          ...state.connections,
          [projectId]: {
            ...existing,
            phase: event.phase.label,
            steps,
          },
        },
      };
    });
  },

  // ...rest of existing methods...
}));
```

#### Step 2: Write a test for `handleProvisionEvent`

Create `apps/web/src/remoteConnectionStore.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useRemoteConnectionStore } from "./remoteConnectionStore";

describe("remoteConnectionStore.handleProvisionEvent", () => {
  beforeEach(() => {
    useRemoteConnectionStore.setState({ connections: {} });
  });

  it("creates steps from phase-start events", () => {
    useRemoteConnectionStore.getState().handleProvisionEvent({
      projectId: "p1",
      phase: "Establishing SSH connection",
      event: {
        type: "phase-start",
        phase: { index: 1, label: "Establishing SSH connection", total: 5 },
        timestamp: 1000,
      },
    });

    const entry = useRemoteConnectionStore.getState().getEntry("p1");
    expect(entry?.steps).toHaveLength(1);
    expect(entry?.steps[0]?.status).toBe("active");
    expect(entry?.steps[0]?.label).toBe("Establishing SSH connection");
  });

  it("marks steps complete on phase-complete", () => {
    const store = useRemoteConnectionStore.getState();
    store.handleProvisionEvent({
      projectId: "p1",
      phase: "SSH",
      event: {
        type: "phase-start",
        phase: { index: 1, label: "SSH", total: 5 },
        timestamp: 1000,
      },
    });
    store.handleProvisionEvent({
      projectId: "p1",
      phase: "SSH",
      event: {
        type: "phase-complete",
        phase: { index: 1, label: "SSH", total: 5 },
        message: "Done",
        timestamp: 2000,
      },
    });

    const entry = useRemoteConnectionStore.getState().getEntry("p1");
    expect(entry?.steps[0]?.status).toBe("complete");
    expect(entry?.steps[0]?.logs).toHaveLength(1);
  });

  it("appends log messages to the correct step", () => {
    const store = useRemoteConnectionStore.getState();
    store.handleProvisionEvent({
      projectId: "p1",
      phase: "Binaries",
      event: {
        type: "phase-start",
        phase: { index: 3, label: "Binaries", total: 5 },
        timestamp: 1000,
      },
    });
    store.handleProvisionEvent({
      projectId: "p1",
      phase: "Binaries",
      event: {
        type: "log",
        phase: { index: 3, label: "Binaries", total: 5 },
        message: "Uploading server binary...",
        timestamp: 1500,
      },
    });

    const entry = useRemoteConnectionStore.getState().getEntry("p1");
    expect(entry?.steps[2]?.logs).toHaveLength(1);
    expect(entry?.steps[2]?.logs[0]?.message).toBe("Uploading server binary...");
  });

  it("handles legacy events without structured data", () => {
    const store = useRemoteConnectionStore.getState();
    store.setStatus("p1", "provisioning");
    store.handleProvisionEvent({
      projectId: "p1",
      phase: "provisioning",
    });

    const entry = useRemoteConnectionStore.getState().getEntry("p1");
    expect(entry?.phase).toBe("provisioning");
    expect(entry?.steps).toEqual([]);
  });
});
```

#### Step 3: Run test to verify it fails, then passes with implementation

Run: `cd /Volumes/Code/t3code && npx vitest run apps/web/src/remoteConnectionStore.test.ts`

#### Step 4: Commit

```bash
git add apps/web/src/remoteConnectionStore.ts apps/web/src/remoteConnectionStore.test.ts
git commit -m "feat: store structured SSH provision events in remoteConnectionStore"
```

---

### Subtask 2E: Build the rich timeline UI in the dialog

**Files:**

- Modify: `apps/web/src/components/AddRemoteProjectDialog.tsx`

#### Step 1: Add a provisioning timeline component

Add a `ProvisionTimeline` component inside the dialog file (or as a separate file `apps/web/src/components/ProvisionTimeline.tsx`):

```typescript
import { CheckCircle2Icon, CircleXIcon, LoaderIcon } from "lucide-react";
import type { ProvisionStep } from "../remoteConnectionStore";
import { cn } from "../lib/utils";

function StepIcon({ status }: { status: ProvisionStep["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2Icon className="size-4 text-emerald-500" />;
    case "error":
      return <CircleXIcon className="size-4 text-destructive" />;
    case "active":
      return <LoaderIcon className="size-4 animate-spin text-primary" />;
    case "pending":
      return <div className="mx-0.5 size-3 rounded-full border-2 border-muted-foreground/30" />;
  }
}

export function ProvisionTimeline({ steps }: { steps: ProvisionStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card/50 px-3 py-2">
      {steps.map((step) => (
        <div key={step.index} className="flex flex-col">
          <div className="flex items-center gap-2 py-1">
            <StepIcon status={step.status} />
            <span
              className={cn(
                "text-[11px]",
                step.status === "active" && "font-medium text-foreground",
                step.status === "complete" && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground/50",
                step.status === "error" && "font-medium text-destructive",
              )}
            >
              {step.label}
            </span>
          </div>
          {step.logs.length > 0 && step.status !== "pending" && (
            <div className="ml-6 border-l border-border/50 pl-2 pb-1">
              {step.logs.map((log, i) => (
                <p key={i} className="text-[10px] leading-relaxed text-muted-foreground/70">
                  {log.message}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

#### Step 2: Integrate the timeline into AddRemoteProjectDialog

In the dialog, when `status !== "idle"`, subscribe to `useRemoteConnectionStore` for the current `projectId` and render the `ProvisionTimeline` below the form fields:

```typescript
// Inside the dialog component, add:
import { useRemoteConnectionStore } from "../remoteConnectionStore";
import { ProvisionTimeline } from "./ProvisionTimeline";

// Inside the component body:
const currentProjectIdRef = useRef<string | null>(null);
const steps = useRemoteConnectionStore((s) =>
  currentProjectIdRef.current ? (s.connections[currentProjectIdRef.current]?.steps ?? []) : [],
);
```

Store the `projectId` in the ref when provisioning starts (in `handleSubmit`):

```typescript
const projectId = newProjectId();
currentProjectIdRef.current = projectId;
```

Then in the JSX, between the form fields and error display:

```typescript
          {isSubmitting && steps.length > 0 && (
            <ProvisionTimeline steps={steps} />
          )}
```

Also wire up the `onSshStatusUpdate` listener to feed the store. In the `useEffect` that runs when `open` changes:

```typescript
useEffect(() => {
  if (!open || !isElectron || !window.desktopBridge) return;
  const unsubscribe = window.desktopBridge.onSshStatusUpdate((update) => {
    useRemoteConnectionStore.getState().handleProvisionEvent(update);
  });
  // Note: onSshStatusUpdate currently doesn't return an unsub function.
  // If it does, call it on cleanup. Otherwise this is fine for the dialog lifecycle.
}, [open]);
```

Note: Check `preload.ts` -- `onSshStatusUpdate` currently does not return an unsubscribe function. This is a minor issue that should be fixed as part of this subtask by updating the preload to return the cleanup function (change `ipcRenderer.on` to return the remove listener).

#### Step 3: Update `preload.ts` `onSshStatusUpdate` to return cleanup function

Change in `apps/desktop/src/preload.ts`:

```typescript
  onSshStatusUpdate: (listener: (update: DesktopSshStatusUpdate) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, update: unknown) => {
      if (typeof update === "object" && update !== null) {
        listener(update as DesktopSshStatusUpdate);
      }
    };
    ipcRenderer.on(SSH_STATUS_UPDATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(SSH_STATUS_UPDATE_CHANNEL, wrappedListener);
    };
  },
```

Also update the `DesktopBridge` interface in contracts to reflect the return type:

```typescript
  onSshStatusUpdate: (listener: (update: DesktopSshStatusUpdate) => void) => () => void;
```

#### Step 4: Typecheck and manual test

Run: `cd /Volumes/Code/t3code && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: PASS

Manual test: Connect to a real SSH host and verify the timeline shows each phase with spinners, checks, and log lines.

#### Step 5: Commit

```bash
git add apps/web/src/components/AddRemoteProjectDialog.tsx apps/web/src/components/ProvisionTimeline.tsx apps/desktop/src/preload.ts packages/contracts/src/ipc.ts
git commit -m "feat: rich SSH provisioning timeline in Add Remote Project dialog

Replaces the bare 'Provisioning SSH tunnel...' text with a vertical
stepper showing all 5 provisioning phases with spinner/check/error
icons and expandable log lines. Also fixes onSshStatusUpdate to
return a cleanup function for proper listener management."
```

---

## Summary of All Commits (in order)

| #   | Task               | Commit message                                                         |
| --- | ------------------ | ---------------------------------------------------------------------- |
| 1   | 3 (bug fix)        | `fix: use server package version for SSH binary version comparison`    |
| 2   | 1A (contracts)     | `feat: add SavedSshHost type and bridge methods to contracts`          |
| 3   | 1B (desktop IPC)   | `feat: implement saved SSH hosts IPC persistence on desktop side`      |
| 4   | 1C (dialog picker) | `feat: add saved SSH host picker to Add Remote Project dialog`         |
| 5   | 1D (settings UI)   | `feat: add SSH host management UI to Connections settings`             |
| 6   | 2A (contracts)     | `feat: extend DesktopSshStatusUpdate with structured provision events` |
| 7   | 2B (provisioner)   | `feat: emit structured provision events from SSH provisioner`          |
| 8   | 2C (desktop IPC)   | `feat: forward structured SSH provision events through desktop IPC`    |
| 9   | 2D (store)         | `feat: store structured SSH provision events in remoteConnectionStore` |
| 10  | 2E (timeline UI)   | `feat: rich SSH provisioning timeline in Add Remote Project dialog`    |

---

I was unable to write the plan file since this is a read-only session. The plan above should be saved to `/Volumes/Code/t3code/docs/plans/2026-04-12-ssh-remote-ux.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open a new session with executing-plans, batch execution with checkpoints

Which approach?

### Critical Files for Implementation

- `/Volumes/Code/t3code/packages/contracts/src/ipc.ts` -- The central type definitions for `DesktopBridge`, `DesktopSshStatusUpdate`, and the new `SavedSshHost` type. Every task touches this file.
- `/Volumes/Code/t3code/packages/shared/src/provision.ts` -- The SSH provisioner that needs both the version fix (Task 3) and structured event emission (Task 2).
- `/Volumes/Code/t3code/packages/shared/src/ssh.ts` -- Pure SSH helpers where `normalizeVersion()` lives (Task 3).
- `/Volumes/Code/t3code/apps/desktop/src/main.ts` -- The Electron main process IPC handler registration, saved hosts persistence, and version passing (all three tasks).
- `/Volumes/Code/t3code/apps/web/src/components/AddRemoteProjectDialog.tsx` -- The React dialog that gains both the host picker (Task 1) and the rich timeline (Task 2).
