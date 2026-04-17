# Remote Environment Lifecycle Redesign

## Problem

The current remote environment system conflates **identity** (which remote am I connecting to?) with **connection state** (what's the current tunnel URL?). This causes:

- "This environment is already connected" errors when re-provisioning
- Stale entries that persist across app restarts with no way to manage them
- No visibility into connection state in the sidebar
- No way to disconnect, reconnect, or remove remote environments

## Design Principles

- Remote identity is `host+user+workspaceRoot` (the user's mental model), not the server-assigned `environmentId`
- Connection state is ephemeral and transient — tunnel ports change every session
- Lazy reconnect on startup — show saved remotes as disconnected, connect on demand
- Four connection states: Connected, Connecting, Disconnected, Error

## Data Model

### RemoteIdentityKey

Stable key derived from SSH target: `` `${user}@${host}:${port}:${workspaceRoot}` ``

### SavedRemoteEnvironment

```typescript
interface SavedRemoteEnvironment {
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

### Registry Store

```typescript
interface SavedEnvironmentRegistryState {
  byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>;
  identityKeyByEnvironmentId: Record<EnvironmentId, RemoteIdentityKey>;
}
```

## State Machine

```
                    +----------+
         +-------->|  Saved   |<---- "Add Remote Project" creates entry
         |         | (initial)|      with null environmentId
         |         +-----+----+
         |               |
         |          user clicks / context menu "Reconnect"
         |               |
         |               v
         |         +------------+
         |    +--->| Connecting |---- SSH provision + fetch environmentId
         |    |    |  (pulsing) |     + bootstrap bearer session
         |    |    +------+-----+
         |    |           |
         |    |     +-----+------+
         |    |     v            v
         |    | +--------+  +-------------+
         |    | |Connected|  |Disconnected |
         |    | | (green) |  |(gray slash) |
         |    | +----+----+  +------+------+
         |    |      |              |
         |    |   tunnel dies /     | click cloud /
         |    |   WS drops /        | "Reconnect"
         |    |   "Disconnect"      |
         |    |      |              |
         |    |      v              |
         |    | +-------------+     |
         |    +-|Disconnected |<----+
         |      |(gray slash) |
         |      +-------------+
         |
         |  "Remove remote"
         v
    +----------+
    | Removed  |---- delete saved entry + kill tunnel + optionally kill tmux
    +----------+
```

- **Connected -> Disconnected**: automatic when SSH tunnel dies or WebSocket drops
- **Disconnected -> Connecting**: user-initiated only (click cloud icon or "Reconnect")
- **Error**: sub-state of Disconnected — red cloud with error message, same transitions
- **Remove**: terminal — entry deleted, bearer token cleared, tunnel killed

## Startup Behavior

Lazy reconnect:

1. Hydrate saved environment registry from disk
2. Show all saved remotes in sidebar as "Disconnected" (gray cloud)
3. Do NOT provision any tunnels automatically
4. When user clicks a remote project or thread, provision on demand

## Sidebar Integration

### Cloud Connectivity Icon

Renders inline with project name for remote projects only:

| State        | Icon       | Color                                 |
| ------------ | ---------- | ------------------------------------- |
| Connected    | `Cloud`    | `text-emerald-500`                    |
| Connecting   | `Cloud`    | `text-muted-foreground animate-pulse` |
| Disconnected | `CloudOff` | `text-muted-foreground`               |
| Error        | `CloudOff` | `text-red-500`                        |

Click behavior: when disconnected/error, clicking the cloud triggers reconnect (no dialog).

Tooltip shows connection details (tunnel mapping) or error message.

### Context Menu

Right-click a remote project adds:

```
Copy Project Path
-----------------
Reconnect          (when disconnected/error)
Disconnect         (when connected)
-----------------
Remove remote      (always, destructive)
```

"Remove remote" confirmation includes checkbox: "Also stop the remote server (kill tmux session)".

### Thread Visibility

Threads under disconnected remotes shown grayed out. Clicking a thread triggers reconnect first, then navigates once connected.

## Add Remote Project Dialog

Three scenarios based on `identityKey` matching:

1. **New remote** (no match): current flow — provision, register, create project
2. **Existing remote** (match found): dialog switches to "Reconnect" mode — provision, update URLs, skip project creation. Inline banner: "This remote is already saved as **label**. Reconnecting will re-establish the tunnel."
3. **Same host, different workspace**: treated as new (different `identityKey`)

Detection happens as user types — computed `identityKey` checked against registry in real time.

## Settings Panel

New "Remote Environments" section with a table:

| Label   | Host                        | Status       | Last Connected | Actions             |
| ------- | --------------------------- | ------------ | -------------- | ------------------- |
| devbox  | james@hephaestus:22 ~/myapp | Connected    | just now       | Disconnect - Remove |
| staging | james@staging:22 ~/api      | Disconnected | 2 days ago     | Reconnect - Remove  |

- Labels editable inline
- "Remove all disconnected" bulk action at bottom

## Connection Manager Implementation

### Bridge between identity and connection layers

```typescript
// Identity layer (stable, persisted)
identityKeyToEnvironmentId: Map<RemoteIdentityKey, EnvironmentId>;

// Connection layer (transient, keyed by environmentId for WS routing)
environmentConnections: Map<EnvironmentId, EnvironmentConnection>;
```

### addOrReconnectSavedEnvironment()

Replaces `addSavedEnvironment()`:

1. Provision SSH tunnel -> get wsUrl, httpBaseUrl, pairingUrl
2. Fetch environmentId from remote server
3. Look up identityKey in registry
4. If exists: update URLs + environmentId, refresh bearer session, reconnect
5. If new: create entry, bootstrap bearer session, connect, return for project creation

Eliminates the "already connected" error — no path throws for a known identity.

## Desktop Bridge IPC Changes

```typescript
// Existing (unchanged)
sshConnect(opts): Promise<{ wsUrl, httpBaseUrl, pairingUrl }>
sshDisconnect(projectId): Promise<{ ok: boolean }>
sshStatus(): Promise<{ connections: Array<...> }>

// New
sshProbe(opts: { host, user, port }): Promise<{ reachable: boolean }>
sshKillRemoteSession(opts: { host, user, port, projectId }): Promise<void>
```

- **sshProbe**: lightweight SSH control socket check (~100ms). For settings panel reachability.
- **sshKillRemoteSession**: `tmux kill-session` on remote. For "Remove remote" with cleanup checkbox.
- **sshDisconnect**: should also accept identity key / SSH target fields, not just projectId.
