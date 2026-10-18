# Roadmap

The roadmap is a fork feature. Its state is a separate event stream held by one environment, the
roadmap home. Every write goes through
[`RoadmapService`](../../apps/server/src/fork/roadmap/RoadmapService.ts), which the RPC, the MCP
tools and the turn context all call.

## A sibling event stream

Roadmap state lives in `roadmap_events`, `roadmap_command_receipts` and projection tables for
items, attachments and sprints, created by fork migrations 7
([`007_Roadmap.ts`](../../apps/server/src/persistence/fork/migrations/007_Roadmap.ts)) and 8
([`008_RoadmapCalendar.ts`](../../apps/server/src/persistence/fork/migrations/008_RoadmapCalendar.ts)). It follows
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

Sprints are records in the same stream, not items, but their events store the sprint id in
`roadmap_events.item_id`. `toStoredEvents` in
[`RoadmapStore.ts`](../../apps/server/src/fork/roadmap/RoadmapStore.ts) reads the column back as
`sprintId` only when the event type starts with `roadmap.sprint.`, so a new sprint event must keep
that prefix. Deleting a sprint clears it from its items in the same commit, but the change is
recorded only on the `roadmap.sprint.deleted` event, in `clearedItemIds`. The items' own events do
not show it.

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

## Calculations run where the data is

Velocity, forecasts, burn, rank and working-day arithmetic live in one pure module,
[`roadmapCalc.ts`](../../packages/shared/src/roadmapCalc.ts), exported as
`@lathe/shared/roadmapCalc`. It never reads the clock. Every function that depends on the date takes
`today`.

There is no server endpoint for Today or the Timeline. Clients build both from the snapshot they
already stream, in [`today.ts`](../../packages/client-runtime/src/roadmap/today.ts) and
[`timeline.ts`](../../packages/client-runtime/src/roadmap/timeline.ts). Today needs thread shells
and pull request review requests from every connected environment, and only the client holds those.
The server runs the same module for the MCP tools and the turn context, through
[`RoadmapProgress.ts`](../../apps/server/src/fork/roadmap/RoadmapProgress.ts). An agent and the
Roadmap page agree because they share this code. Change a rule in the module, never in a view or a
handler.

## History lives on the item

The calculations need history that phase 1 items did not keep: when the state last changed, when the
item was completed, when each criterion was ticked, and the hours log. Clients receive items, not
events, so the item carries this history in `payload_json` and the planner maintains it.
`completedAt` clears when an item leaves Done.

Migration 8 backfilled `stateChangedAt` and `completedAt` in the item projection from `updated_at`.
It also upgraded the stored `roadmap.item.created` payloads, taking the same fields from the
creation time, because `RoadmapStore.rebuild` decodes every stored event with the current schema. A
future required item field needs the same upgrade or a decoding default, or a rebuild cannot decode
old events. The backfilled values are approximate. A phase 1 item that was done counts as completed
on its last update, which can put it in the first velocity window.

## Dates without a time zone

The server does not know the user's time zone. Clients compute in local dates (`localDateOf`), and
the server uses UTC dates (`todayUtc` and `utcDateOf`). A forecast in the MCP tools or the turn
context can differ from the page by a day near midnight.

The planner's snooze check refuses only dates on or before the UTC-12 date, the earliest calendar
date anywhere (`earliestToday` in
[`RoadmapCommands.ts`](../../apps/server/src/fork/roadmap/RoadmapCommands.ts)). Comparing with the
UTC date would refuse **Tomorrow** for users west of UTC in their evening. A date already past for
the user can be accepted. It expires at once, because each reader decides whether an item is snoozed
against its own today.
