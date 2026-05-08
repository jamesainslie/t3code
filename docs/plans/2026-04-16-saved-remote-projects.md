# Saved Remote Projects as First-Class Entities

## Problem

`SavedRemoteEnvironment` made remote _environments_ persistent and
independently reconnectable, but the projects inside those environments
remained ephemeral: they lived only in the live orchestration read-model.
When a remote environment disconnected, all of its projects vanished
from the sidebar until the user re-paired the environment.

This created a "split-brain" UX: the environment registry showed a
"Reconnect" pill for the remote, but there was no way to pick a specific
project inside that remote to reconnect into — only the whole remote.

## Goals

- Persist `SavedRemoteProject` records across app restarts, keyed by
  `(environmentIdentityKey, projectId)`.
- Keep the registry in sync with live data via snapshot sync and event
  batch sync, without the two sources fighting each other.
- Cascade project removal when a parent environment is removed.
- Render stale saved projects in the sidebar with a per-project
  "Reconnect" affordance so users can drop straight back into a remote
  project.

## Non-goals

- Replacing the existing cross-environment project grouping /
  drag-to-reorder logic. Stale entries cannot participate in those
  features and are rendered in a separate "Disconnected" section.
- Per-project secrets or credentials. Stale project reconnect always
  piggybacks on the parent saved environment's credentials.

## Data Model

### SavedProjectKey

Branded string: `` `${environmentIdentityKey}#${projectId}` ``. Derived
via `makeSavedProjectKey`; safe to use as a React key or registry index.

### SavedRemoteProject

```typescript
interface SavedRemoteProject {
  readonly savedProjectKey: SavedProjectKey;
  readonly environmentIdentityKey: RemoteIdentityKey;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryCanonicalKey: string | null;
  readonly firstSeenAt: string; // set on first insert, never overwritten
  readonly lastSeenAt: string; // updated on every observation
  readonly lastSyncedEnvironmentId: EnvironmentId | null;
}
```

`firstSeenAt` is preserved across upserts so UI can show "you've had
this project for 3 months" without the timestamp moving on every sync.

## Storage

Desktop persists the registry to the Electron `userData` directory via
`persistence.getSavedProjectRegistry / setSavedProjectRegistry`. The
browser fallback uses `localStorage` under the same keyspace as the
saved-environment registry.

## Sync Contract

Two sync paths both call a shared `syncSavedProjectsCore` helper so the
upsert / prune logic is identical regardless of input source:

1. **`syncSavedProjectsFromReadModel`** — called from the WebSocket
   snapshot handler with `OrchestrationProject[]`. Prunes projects no
   longer present on the server for that environment.
2. **`syncSavedProjectsFromWebProjects`** — called after
   `applyOrchestrationEvents` during recovery with the post-apply `web`
   project shape. Same upsert/prune semantics.

## Hydration

Hydration uses merge-precedence: values already upserted during boot
(e.g. from an immediate snapshot that arrives before persistence
resolves) win over hydrated records. This prevents the initial
persistence read from clobbering fresh server state.

## Reconnect

`reconnectSavedProject(savedProjectKey)` looks up the project, resolves
its parent saved environment, and — if the environment is not currently
connected — invokes `connectSavedEnvironment`. On success returns
`{ environmentId, projectId }` so callers can navigate.

Error branches (exhaustively tested in `service.test.ts`):

- Saved project not in registry
- Parent saved environment not in registry
- Parent environment has no `environmentId` yet

## UI

- `selectSidebarProjectEntries` merges live projects with the saved
  registry and produces a flat, name-sorted list. Live entries
  suppress their saved counterparts via `makeSavedProjectKey`.
- `SavedProjectReconnectButton` wraps `reconnectSavedProject` with local
  busy state and surfaces failures via the global toast manager.
- `StaleSavedProjectsList` is a self-contained sidebar section. It
  filters for `isStale === true`, renders a row per stale project, and
  on successful reconnect sets the active environment and navigates to
  the chat index.

## Implementation Phases

1. Contract types (`SavedRemoteProject`, `SavedProjectKey`)
2. Desktop persistence (main handlers + preload)
3. IPC bridge + `LocalApi` + browser fallback
4. `useSavedProjectRegistryStore` zustand store
5. Sync on snapshot
6. Sync on event batch
7. Cascade on environment removal
8. Hydrate at boot
9. Pure `selectSidebarProjectEntries` selector
10. `reconnectSavedProject` service function
11. `SavedProjectReconnectButton` component
12. Sidebar integration (`StaleSavedProjectsList`)
13. Navigate on reconnect success
14. UX polish (icon, env label, italic muted name)
15. This document
