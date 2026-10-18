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

- Only the home applies commands. `dispatch` elsewhere fails with `roadmap_home_elsewhere`.
- Off the home, an environment linked to the home forwards reads and queues writes (see
  [The one-way link](#the-one-way-link)). An environment that is neither refuses reads too, because
  its local tables are empty rather than the roadmap.
- `roadmap.subscribe` does not check the home. Subscribing to the wrong environment returns an
  empty roadmap, not an error.

Clients talk to the home directly. The web client reads the setting from the primary environment
only (`useRoadmapHome` in [`state/roadmap.ts`](../../apps/web/src/state/roadmap.ts)). A client
with no primary environment resolves no home and shows no roadmap. On any other
environment, the setting only decides whether that environment's own MCP tools and turn context
treat it as the home.

Every environment defaults to null, so each one considers itself the home until told otherwise. An
agent on a second environment left at the default reads and writes that environment's own roadmap,
which no client shows.

Threads on other environments attach by reference, as an environment id and a thread id. A client
connected to both environments can attach them. Their agents reach the roadmap only through their
environment's link; without one they get `roadmap_home_elsewhere` from the MCP tools and no context
block.

Changing the setting does not move any data. The new home shows its own roadmap.

## The one-way link

An environment that is not the home holds the home's URL and a roadmap-link session in its secret
store ([`RoadmapLink`](../../apps/server/src/fork/roadmap/RoadmapLink.ts)). It calls the home over
HTTP, through the environment API's `roadmap` group
([`http.ts`](../../apps/server/src/fork/roadmap/http.ts)). The home never connects out, so a home
that is a laptop asleep half the day costs the other environments nothing but a queue.

The session's subject is `roadmap-link:<environmentId>` and its scopes are `roadmap:read` and
`roadmap:write`. Every other HTTP and WebSocket path refuses the subject, as they refuse
`mcp-client` (see [environment auth](./environment-auth.md)). The reason is the actor check: the
home applies a write only when its actor is an agent or steward of the environment the subject
names, and refuses user and GitHub actors outright. No other path makes that check, so a link
session there could act as the user. The roadmap group also refuses when its own environment is not
the home, so a link can never forward a call on to a further home.

Linking goes through the client, which is connected to both environments. It mints a one-time grant
on the home (`roadmap.link.mint`) and hands it to the other environment (`roadmap.link.configure`),
which spends it at the home's `/oauth/token` for a session that lasts a year. The year-long
credential never passes through the client, and configuring fails, storing nothing, when the other
environment cannot reach the home at the URL it was given. Both RPCs need `access:write`. Revoking
the session in the home's connections list cuts the link; the other side then reports it
unreachable.

### Writes queue; reads do not

`RoadmapService.submit` is the write path for agents. Off the home it puts the command in
`roadmap_link_outbox` (fork migration 9), and
[`RoadmapLinkOutbox`](../../apps/server/src/fork/roadmap/RoadmapLinkOutbox.ts) sends it.

- One worker sends the oldest pending row and nothing behind it, so the home applies writes in the
  order they were made. A transport failure leaves the row at the head.
- Transport failures retry forever, waiting one second and doubling to a minute. The home's
  `internal` and `roadmap_home_elsewhere` answers count as transport failures, because the home may
  answer differently later.
- Any other `RoadmapError` from the home ends that row alone. It stays in the table as `rejected`
  with the error, is never sent again, and a later submit of the same command answers with it.
- Resending a row the home applied but whose answer was lost is safe, because the home's command
  receipts replay the first outcome.

A submit waits up to five seconds for the home's answer, so an agent on a reachable home still hears
a refusal. A failed try at the home ends every wait at once, and the MCP tools then report
`{ queued: true, itemId }`. While the home is already known to be down, a submit does not wait.

Reads go straight to the home with a ten second timeout and fail when it does not answer. Tools
that name their item therefore skip reading it first, so they can still queue while the home is
down. Resolving a thread's own item needs the home to answer.

### Possibly out of date

The turn context keeps the last block the home rendered for each thread, in memory. When the home
does not answer within three seconds, the agent gets that copy with a first line saying it is
possibly out of date and when it was fetched. A thread with no copy gets no block. Unlinking drops
the copies, and a restart loses them.

The home renders the block for every environment (`forThread` on the roadmap group), so agents on
every environment see the same text and only one copy of the renderer exists.

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
- `forThread` never fails. It logs a warning and returns the last copy, or an empty block, on any
  error or defect, so a roadmap problem cannot stop a turn.
- Steered messages do not pass through turn start and carry no block.

The attachment projection allows several items per thread. The planner refuses a second one with
`already_attached`, and both the turn context and the MCP tools read only the thread's first item.
Allowing more than one item per thread needs all three changed.
