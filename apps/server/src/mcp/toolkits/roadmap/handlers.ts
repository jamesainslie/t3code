import {
  CommandId,
  OrchestratorMcpFailure,
  type RoadmapActor,
  type RoadmapItemCommand,
  type RoadmapError,
  RoadmapItemId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
  type ThreadId,
} from "@lathe/contracts";
import { parseChangeRequestUrl } from "@lathe/shared/changeRequestUrl";
import { effectiveArea, effectivePriority } from "@lathe/shared/roadmap";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as RoadmapProgress from "../../../fork/roadmap/RoadmapProgress.ts";
import * as RoadmapGitHubSync from "../../../fork/roadmap/RoadmapGitHubSync.ts";
import * as RoadmapService from "../../../fork/roadmap/RoadmapService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import {
  type RoadmapChangeResult,
  type RoadmapListEntry,
  type RoadmapReadResult,
  RoadmapToolFailure,
  RoadmapToolkit,
} from "./tools.ts";

const HISTORY_LIMIT = 20;

const toolFailure = (error: RoadmapError) =>
  new RoadmapToolFailure({ code: error.code, reason: error.message });

const notFound = (itemId: RoadmapItemId) =>
  new RoadmapToolFailure({ code: "not_found", reason: `No work item ${itemId}.` });

/** Tool inputs mark absent fields undefined; roadmap commands want them left out. */
const definedFields = <T extends object>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [Key in keyof T]?: Exclude<T[Key], undefined>;
  };

/** Ancestors of the item, top-level first; stops at a missing parent or a corrupt loop. */
function parentsOf(item: RoadmapWorkItem, byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>) {
  const parents: Array<RoadmapWorkItem> = [];
  const seen = new Set<RoadmapItemId>([item.id]);
  let parent = item.parentId === null ? undefined : byId.get(item.parentId);
  while (parent !== undefined && !seen.has(parent.id)) {
    seen.add(parent.id);
    parents.unshift(parent);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return parents;
}

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;

  const fromService = <A>(effect: Effect.Effect<A, RoadmapError>) =>
    effect.pipe(Effect.mapError(toolFailure));

  // Off the home, an unlinked environment has no roadmap to read or change:
  // its own tables are empty, not the roadmap.
  const requireRoadmap = Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.requireMcpCapability("roadmap");
    const scope = yield* McpInvocationContext.requireThreadScope(invocation, "Roadmap tools");
    if ((yield* fromService(roadmap.location)) === "not-linked") {
      return yield* new RoadmapToolFailure({
        code: "roadmap_home_elsewhere",
        reason:
          "The roadmap lives on another environment, and this one is not linked to it. Link it in Settings, Roadmap.",
      });
    }
    return scope;
  });

  /** Forecasts over the whole roadmap as it stands now, in each area's unit. */
  const progressSnapshot = Effect.gen(function* () {
    const snapshot = yield* fromService(roadmap.snapshot());
    return RoadmapProgress.progressCalculator({
      ...snapshot,
      today: yield* RoadmapProgress.todayUtc,
    });
  });

  const threadRef = (
    scope: McpInvocationContext.McpThreadInvocationScope,
    threadId: ThreadId = scope.thread.threadId,
  ): RoadmapThreadRef => ({ environmentId: scope.environmentId, threadId });

  const attachedItem = (thread: RoadmapThreadRef) =>
    fromService(roadmap.forThread(thread)).pipe(
      Effect.flatMap(([item]) =>
        item === undefined
          ? Effect.fail(
              new RoadmapToolFailure({
                code: "not_attached",
                reason: `Thread ${thread.threadId} is not attached to a work item. Pass itemId, or attach the thread with lathe_roadmap_attach.`,
              }),
            )
          : Effect.succeed(item),
      ),
    );

  const getItem = (itemId: RoadmapItemId) =>
    fromService(roadmap.get(itemId)).pipe(
      Effect.flatMap(
        Option.match({ onNone: () => Effect.fail(notFound(itemId)), onSome: Effect.succeed }),
      ),
    );

  const targetItem = (
    scope: McpInvocationContext.McpThreadInvocationScope,
    itemId?: RoadmapItemId,
  ) => (itemId === undefined ? attachedItem(threadRef(scope)) : getItem(itemId));

  // A named item needs no read: the home refuses a missing one itself, and off
  // the home a write can then queue while the home is unreachable.
  const targetItemId = (
    scope: McpInvocationContext.McpThreadInvocationScope,
    itemId?: RoadmapItemId,
  ) =>
    itemId === undefined
      ? attachedItem(threadRef(scope)).pipe(Effect.map((item) => item.id))
      : Effect.succeed(itemId);

  const agentActor = (scope: McpInvocationContext.McpThreadInvocationScope) =>
    threads.getThreadShell(scope.thread.threadId).pipe(
      Effect.mapError(unavailable),
      Effect.map((shell): RoadmapActor => ({
        _tag: "agent",
        thread: threadRef(scope),
        threadTitle: shell?.title ?? scope.thread.threadId,
      })),
    );

  // The request namespace is per provider session, so one agent's retries
  // replay its own commands and never another session's.
  const commandId = (
    scope: McpInvocationContext.McpThreadInvocationScope,
    tool: string,
    clientRequestId: string | undefined,
  ) =>
    Effect.gen(function* () {
      const requestKey = clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      return CommandId.make(
        ["command", "mcp", scope.requestNamespace, "roadmap", tool, requestKey]
          .map(encodeURIComponent)
          .join(":"),
      );
    });

  const dispatch = (
    scope: McpInvocationContext.McpThreadInvocationScope,
    tool: string,
    clientRequestId: string | undefined,
    build: (commandId: CommandId) => RoadmapItemCommand,
  ) =>
    Effect.gen(function* () {
      const actor = yield* agentActor(scope);
      const command = build(yield* commandId(scope, tool, clientRequestId));
      const result = yield* fromService(roadmap.submit(command, actor));
      // A replayed create returns the item the first attempt made, not this attempt's new id.
      const itemId = result.itemId ?? command.itemId;
      const change: RoadmapChangeResult = result.queued
        ? { itemId, queued: true }
        : { itemId, sequence: result.sequence };
      return change;
    });

  const refuseDoneWithOpenCriteria = (texts: ReadonlyArray<string>) =>
    texts.length === 0
      ? Effect.void
      : Effect.fail(
          new RoadmapToolFailure({
            code: "open_criteria",
            reason: `Tick every acceptance criterion with evidence before marking the item done. Still open: ${texts
              .map((text) => `"${text}"`)
              .join(", ")}.`,
          }),
        );

  const existingThread = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.mapError(unavailable),
      Effect.flatMap((shell) =>
        shell === null || shell.deletedAt !== null
          ? Effect.fail(
              new OrchestratorMcpFailure({
                code: "thread_not_found",
                message: `Thread ${threadId} was not found.`,
              }),
            )
          : Effect.void,
      ),
    );

  return {
    lathe_roadmap_list: McpToolAccess.readsAsCaller((input) =>
      Effect.gen(function* () {
        yield* requireRoadmap;
        const { byId, progressOf } = yield* progressSnapshot;
        if (input.underItemId !== undefined && !byId.has(input.underItemId)) {
          return yield* notFound(input.underItemId);
        }
        const rows: Array<RoadmapListEntry> = [];
        for (const item of byId.values()) {
          if (input.type !== undefined && item.type !== input.type) continue;
          if (input.state !== undefined && item.state !== input.state) continue;
          const area = effectiveArea(item.id, byId).area;
          if (input.area !== undefined && area !== input.area) continue;
          if (
            input.underItemId !== undefined &&
            !parentsOf(item, byId).some((parent) => parent.id === input.underItemId)
          ) {
            continue;
          }
          rows.push({
            id: item.id,
            type: item.type,
            title: item.title,
            state: item.state,
            priority: effectivePriority(item.id, byId).priority,
            area,
            parentId: item.parentId,
            dueDate: item.dueDate,
            criteriaTicked: item.criteria.filter((criterion) => criterion.tickedAt !== null).length,
            criteriaTotal: item.criteria.length,
            attachedThreads: item.attachments.length,
            needsReview: item.needsReview,
            focused: item.focusedAt !== null,
            forecast: progressOf(item).forecast.status,
          });
        }
        return { items: rows };
      }),
    ),
    lathe_roadmap_read: McpToolAccess.readsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const item = yield* targetItem(scope, input.itemId);
        const { byId, progressOf } = yield* progressSnapshot;
        const progress = progressOf(item);
        const { history } = yield* fromService(roadmap.item(item.id));
        const summary = (candidate: RoadmapWorkItem) => ({
          id: candidate.id,
          type: candidate.type,
          title: candidate.title,
        });
        return {
          item,
          effectivePriority: effectivePriority(item.id, byId).priority,
          effectiveArea: effectiveArea(item.id, byId).area,
          parents: parentsOf(item, byId).map(summary),
          blockedBy: item.blockedBy.flatMap((blockerId) => {
            const blocker = byId.get(blockerId);
            return blocker === undefined ? [] : [{ ...summary(blocker), state: blocker.state }];
          }),
          history: history.slice(-HISTORY_LIMIT).map(({ sequence, event }) => ({
            sequence,
            type: event.type,
            actor: event.actor,
            occurredAt: event.occurredAt,
          })),
          unit: progress.unit,
          burned: progress.burned,
          remaining: progress.remaining,
          velocity:
            progress.velocity === null
              ? null
              : { perDay: progress.velocity.perDay, sampleSize: progress.velocity.sampleSize },
          forecast: { status: progress.forecast.status, projected: progress.forecast.projected },
        } satisfies RoadmapReadResult;
      }),
    ),
    lathe_roadmap_create: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        if (input.state === "done") {
          // New criteria start unticked.
          yield* refuseDoneWithOpenCriteria(input.criteria ?? []);
        }
        const { type, title, criteria, attachCaller, clientRequestId, ...fields } = input;
        const itemId = RoadmapItemId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
        return yield* dispatch(scope, "create", clientRequestId, (commandId) => ({
          type: "roadmap.item.create",
          commandId,
          itemId,
          itemType: type,
          title,
          ...definedFields(fields),
          ...(criteria === undefined ? {} : { criteria: criteria.map((text) => ({ text })) }),
          origin: threadRef(scope),
          ...(attachCaller === true ? { attachThread: threadRef(scope) } : {}),
        }));
      }),
    ),
    lathe_roadmap_update: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const { itemId, clientRequestId, ...fields } = input;
        const patch = definedFields(fields);
        if (Object.keys(patch).length === 0) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Pass at least one field to change.",
          });
        }
        // Done needs the criteria, so only that change reads the item first.
        const targetId =
          patch.state === "done"
            ? yield* targetItem(scope, itemId).pipe(
                Effect.tap((item) =>
                  refuseDoneWithOpenCriteria(
                    item.criteria
                      .filter((criterion) => criterion.tickedAt === null)
                      .map((criterion) => criterion.text),
                  ),
                ),
                Effect.map((item) => item.id),
              )
            : yield* targetItemId(scope, itemId);
        return yield* dispatch(scope, "update", clientRequestId, (commandId) => ({
          type: "roadmap.item.update",
          commandId,
          itemId: targetId,
          patch,
        }));
      }),
    ),
    lathe_roadmap_criterion_tick: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const itemId = yield* targetItemId(scope, input.itemId);
        return yield* dispatch(scope, "criterion-tick", input.clientRequestId, (commandId) => ({
          type: "roadmap.criterion.tick",
          commandId,
          itemId,
          criterionId: input.criterionId,
          ticked: input.ticked,
          evidence: input.evidence ?? null,
        }));
      }),
    ),
    lathe_roadmap_attach: McpToolAccess.writesThreads(
      (input) => [input.threadId],
      (input) =>
        Effect.gen(function* () {
          const scope = yield* requireRoadmap;
          if (input.threadId !== undefined) yield* existingThread(input.threadId);
          return yield* dispatch(scope, "attach", input.clientRequestId, (commandId) => ({
            type: "roadmap.thread.attach",
            commandId,
            itemId: input.itemId,
            thread: threadRef(scope, input.threadId),
          }));
        }),
    ),
    lathe_roadmap_detach: McpToolAccess.writesThreads(
      (input) => [input.threadId],
      (input) =>
        Effect.gen(function* () {
          const scope = yield* requireRoadmap;
          const thread = threadRef(scope, input.threadId);
          const itemId = input.itemId ?? (yield* attachedItem(thread)).id;
          return yield* dispatch(scope, "detach", input.clientRequestId, (commandId) => ({
            type: "roadmap.thread.detach",
            commandId,
            itemId,
            thread,
          }));
        }),
    ),
    lathe_roadmap_link_blocker: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const itemId = yield* targetItemId(scope, input.itemId);
        return yield* dispatch(scope, "link-blocker", input.clientRequestId, (commandId) => ({
          type: input.linked ? "roadmap.blocker.link" : "roadmap.blocker.unlink",
          commandId,
          itemId,
          blockedById: input.blockedById,
        }));
      }),
    ),
    lathe_roadmap_log_hours: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const itemId = yield* targetItemId(scope, input.itemId);
        // The entry takes the command id, so a retry that replays the first
        // attempt's receipt reports the same entry instead of a new one.
        let entryId = "";
        const result = yield* dispatch(scope, "log-hours", input.clientRequestId, (commandId) => {
          entryId = commandId;
          return {
            type: "roadmap.hours.log",
            commandId,
            itemId,
            entryId: commandId,
            hours: input.hours,
            ...(input.note === undefined ? {} : { note: input.note }),
          };
        });
        if ("queued" in result) return { itemId: result.itemId, queued: true, entryId } as const;
        const logged = yield* getItem(itemId);
        return {
          ...result,
          entryId,
          totalHours: logged.hours.reduce((sum, entry) => sum + entry.hours, 0),
        };
      }),
    ),
    lathe_roadmap_add_note: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const itemId = yield* targetItemId(scope, input.itemId);
        // The note takes the command id, as an hours entry does, so a retry
        // reports the note the first attempt added.
        let noteId = "";
        const result = yield* dispatch(scope, "add-note", input.clientRequestId, (commandId) => {
          noteId = commandId;
          return {
            type: "roadmap.note.add",
            commandId,
            itemId,
            noteId: commandId,
            // Agents report progress; the other kinds belong to GitHub and the steward.
            kind: "progress",
            text: input.text,
          };
        });
        return { ...result, noteId };
      }),
    ),
    // Imports run on the home with its gh logins and are attributed to
    // GitHub sync, which keeps the items afterwards, rather than the agent.
    lathe_roadmap_import_issue: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        yield* requireRoadmap;
        const sync = yield* RoadmapGitHubSync.RoadmapGitHubSync;
        return yield* fromService(
          sync.importIssue({
            url: input.url,
            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
            ...(input.area === undefined ? {} : { area: input.area }),
          }),
        );
      }),
    ),
    lathe_roadmap_link_pull_request: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const scope = yield* requireRoadmap;
        const link = parseChangeRequestUrl(input.url);
        if (link === null) {
          return yield* new RoadmapToolFailure({
            code: "invalid_request",
            reason: `${input.url} is not a pull request URL.`,
          });
        }
        const itemId = yield* targetItemId(scope, input.itemId);
        return yield* dispatch(scope, "link-pull-request", input.clientRequestId, (commandId) => ({
          type: "roadmap.pull-request.link",
          commandId,
          itemId,
          pullRequest: {
            host: link.host,
            repository: link.repository,
            number: link.number,
            url: input.url,
          },
        }));
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof RoadmapToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(RoadmapToolkit, make);
