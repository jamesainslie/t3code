# Remote SSH — Gap Fix Plan

## What We Learned

The upstream already has a **multi-environment architecture**:

- `Map<EnvironmentId, EnvironmentConnection>` — multiple concurrent WS connections
- Each environment has its own `WsRpcClient` + `WsTransport`
- `SavedEnvironmentRecord` stores `wsBaseUrl` + `httpBaseUrl` per environment
- Components route via `readEnvironmentApi(environmentId)`
- Saved environments already support dynamic URL resolution

**A remote T3 server via SSH tunnel IS a saved environment.** The wsBaseUrl is `ws://127.0.0.1:<tunnelPort>`.

## The 4 Gaps

### Gap 1: Trigger SSH provisioning when remote project is added

**Current:** `useRemoteProjectConnection` only fires for the active-route project (when you open a thread). Adding a project does nothing.

**Fix:** After `project.create` succeeds with `remoteHost`, immediately trigger SSH provisioning. Two options:

- (A) Trigger from the `AddRemoteProjectDialog` after successful dispatch
- (B) Trigger from a store subscriber that watches for new remote projects

Option A is simpler. After `dispatchCommand` succeeds, call `provisionAndRegisterEnvironment()`.

### Gap 2: SSH provisioning → saved environment registration

**Current:** Provisioner returns `{ wsUrl, localPort }` but nothing uses it.

**Fix:** After provisioning succeeds:

1. The remote server exposes `/.well-known/t3/environment` (it already does — all T3 servers do)
2. Fetch the remote server's environment descriptor via the tunnel: `GET http://127.0.0.1:<tunnelPort>/.well-known/t3/environment`
3. Register it as a saved environment using the upstream's `addSavedEnvironment()` (in `environments/runtime/catalog.ts`)
4. The environment connection service (`syncSavedEnvironmentConnections`) picks it up and creates a `WsRpcClient` pointing at the tunnel

### Gap 3: Associate the remote project with its environment

**Current:** Remote projects are created in the LOCAL environment. They need to be in the REMOTE environment.

**Fix:** Don't create the project locally at all. Instead:

1. Provision the SSH tunnel
2. Connect to the remote server as a saved environment
3. Create the project on the REMOTE server (via the remote environment's API)
4. The project appears in the sidebar under the remote environment

This means the `AddRemoteProjectDialog` flow becomes:

1. User fills in host/user/path → clicks "Add"
2. Dialog shows "Provisioning..." status
3. SSH provision runs (install binary, start tmux, port forward)
4. Fetch remote environment descriptor
5. Register as saved environment
6. Create project on the remote server: `remoteApi.orchestration.dispatchCommand({ type: "project.create", ... })`
7. Project appears in sidebar under the remote environment
8. Dialog closes

### Gap 4: Reconnection on app restart

**Current:** Saved environments are persisted in the catalog. On restart, the app tries to reconnect. But the SSH tunnel won't exist yet.

**Fix:** On startup, for each saved environment that has SSH config:

1. Re-provision the SSH tunnel (fast path — binary already installed, tmux session likely still running)
2. Once tunnel is up, let the environment connection service connect normally

This hooks into the existing `warmUpRecentRemoteHosts()` in `desktop/src/main.ts`.

## Implementation Order

1. **Gap 2 first** — make provisioning register a saved environment (this is the core integration)
2. **Gap 1 next** — trigger provisioning from the dialog
3. **Gap 3** — create project on remote server instead of local
4. **Gap 4** — reconnection on restart

## Key Files

| File                                                 | Change                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/components/AddRemoteProjectDialog.tsx` | After provision, register saved env, create project remotely                |
| `apps/web/src/environments/runtime/catalog.ts`       | Add SSH tunnel config to `SavedEnvironmentRecord`                           |
| `apps/web/src/environments/runtime/service.ts`       | Hook SSH tunnel setup into env connection lifecycle                         |
| `apps/web/src/rpc/brokerClient.ts`                   | Add `provisionAndGetEnvironmentInfo()` that provisions + fetches descriptor |
| `apps/desktop/src/sshManager.ts`                     | Add `provisionAndGetEnvironmentInfo()` IPC that does provision + HTTP fetch |
| `apps/desktop/src/main.ts`                           | IPC handler + startup reconnection                                          |
