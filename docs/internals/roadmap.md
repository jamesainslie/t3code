# Roadmap

The roadmap is a fork feature. Its state is a separate event stream held by one environment, the
roadmap home. Every write goes through
[`RoadmapService`](../../apps/server/src/fork/roadmap/RoadmapService.ts), which the RPC, the MCP
tools and the turn context all call.

## A sibling event stream

Roadmap state lives in `roadmap_events`, `roadmap_command_receipts` and two projection tables, all
created by fork migration 7
([`007_Roadmap.ts`](../../apps/server/src/persistence/fork/migrations/007_Roadmap.ts)). It follows
the orchestration model: a pure planner decides the event, and the event, its projection rows and
the command receipt commit in one transaction. It does not write to `orchestration_events`, because
a third aggregate kind there would be mishandled in three places:

- Command receipts accept only the `project` and `thread` aggregate kinds
  ([`OrchestrationCommandReceipts.ts`](../../apps/server/src/persistence/OrchestrationCommandReceipts.ts)).
- Replay decodes every kind other than `project` as a thread event (`rowToApplicationStoredEvent`
  in [`OrchestrationEventStore.ts`](../../apps/server/src/persistence/OrchestrationEventStore.ts)).
- Projection maintenance verifies and rebuilds thread projections only
  ([`ProjectionMaintenance.ts`](../../apps/server/src/orchestration-v2/ProjectionMaintenance.ts)).

Upstream's maintenance never touches the roadmap tables, so it never repairs them either.
`RoadmapStore.rebuild` replays `roadmap_events` into the projections, but no startup or maintenance
path calls it yet.

`RoadmapService` owns the write lock and the publisher for the live stream. Every caller must share
one instance. A second instance would have its own lock and its own stream, so its commits would
never reach the other's subscribers. `server.ts` builds one layer value for both the orchestration
runtime and the fork services for this reason.

The subscribe and dispatch RPCs live in the fork RPC group. See
[fork schema](./fork-schema.md#websocket-rpcs).

## The roadmap home

The server setting `roadmap.homeEnvironmentId` names the home. Null means this environment.
`RoadmapService.isHome` compares it with the environment's own id.

- Only the home accepts commands. Dispatch elsewhere fails with `roadmap_home_elsewhere`.
- MCP tools refuse reads off the home as well, because the local tables there are empty rather than
  the roadmap.
- `roadmap.subscribe` does not check the home. Subscribing to the wrong environment returns an
  empty roadmap, not an error.
- The turn context returns no block off the home.

Clients talk to the home directly. The web client reads the setting from the primary environment
only (`useRoadmapHome` in [`state/roadmap.ts`](../../apps/web/src/state/roadmap.ts)). A client
with no primary environment resolves no home and shows no roadmap. On any other
environment, the setting only decides whether that environment's own MCP tools and turn context
treat it as the home.

Every environment defaults to null, so each one considers itself the home until told otherwise. An
agent on a second environment left at the default reads and writes that environment's own roadmap,
which no client shows.

Threads on other environments attach by reference, as an environment id and a thread id. A client
connected to both environments can attach them. When their environment names the real home, agents
on those threads get `roadmap_home_elsewhere` from the MCP tools and no context block.

Changing the setting does not move any data. The new home shows its own roadmap.

The planned one-way link is not built. Under that plan, each non-home environment holds the home's
address and a credential, calls the home's roadmap service, and queues its calls while the home is
unreachable. The home never connects out.

## Agent context rides in the provider-bound text

An attached thread's agent sees its work item at the start of every turn.
[`RoadmapTurnContext`](../../apps/server/src/fork/roadmap/RoadmapTurnContext.ts) renders the block
and
[`ProviderTurnStartService`](../../apps/server/src/orchestration-v2/ProviderTurnStartService.ts)
prepends it to the provider-bound text, next to handoff context. This is one route for every
adapter. A system prompt cannot carry it, because Claude's system prompt is fixed for the session
and the block must refresh each turn.

- The stored user message is unchanged. The block never appears in the thread's history.
- A message that starts with `/` gets no block, because the provider must see the slash command
  first.
- `forThread` never fails. It logs a warning and returns an empty block on any error or defect, so a
  roadmap problem cannot stop a turn.
- Steered messages do not pass through turn start and carry no block.

The attachment projection allows several items per thread. The planner refuses a second one with
`already_attached`, and both the turn context and the MCP tools read only the thread's first item.
Allowing more than one item per thread needs all three changed.
