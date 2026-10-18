import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapCommand,
  RoadmapError,
  RoadmapItemId,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as RoadmapService from "./RoadmapService.ts";
import * as RoadmapTurnContext from "./RoadmapTurnContext.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");
const user = { _tag: "user" } as const;

const workItem = (id: string, fields: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: RoadmapItemId.make(id),
  type: "feature",
  title: `Item ${id}`,
  description: "",
  parentId: null,
  sortKey: "a0",
  state: "backlog",
  priority: null,
  area: null,
  dueDate: null,
  startDate: null,
  estimate: null,
  criteria: [],
  blockedBy: [],
  externalBlockers: [],
  related: [],
  attachments: [],
  origin: null,
  needsReview: false,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  createdBy: user,
  stateChangedAt: "2026-10-18T00:00:00.000Z",
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  ...fields,
});

const criterion = (id: string, text: string, ticked = false) => ({
  id,
  text,
  tickedAt: ticked ? "2026-10-18T01:00:00.000Z" : null,
  tickedBy: ticked ? user : null,
  evidence: null,
});

const byIdOf = (...items: ReadonlyArray<RoadmapWorkItem>) =>
  new Map(items.map((item) => [item.id, item]));

describe("renderRoadmapContext", () => {
  it("renders the item, its parents, ticked criteria and open blockers", () => {
    const objective = workItem("objective", {
      type: "objective",
      title: "Lathe is my daily driver",
      priority: "p1",
    });
    const epic = workItem("epic", {
      type: "epic",
      title: "Rebrand to Lathe",
      parentId: objective.id,
    });
    const openBlocker = workItem("open-blocker", { title: "Icon set", state: "in-progress" });
    const doneBlocker = workItem("done-blocker", { title: "Old work", state: "done" });
    const feature = workItem("feature", {
      title: "Build-time brand layer",
      parentId: epic.id,
      state: "in-progress",
      dueDate: "2026-10-23",
      criteria: [
        criterion("c1", "Brand tokens resolve at build time", true),
        criterion("c2", "Windows installer art uses the channel name"),
      ],
      blockedBy: [openBlocker.id, doneBlocker.id],
      externalBlockers: [
        { id: "x1", text: "Waiting on the signing cert", resolvedAt: null },
        { id: "x2", text: "Already sorted", resolvedAt: "2026-10-17T00:00:00.000Z" },
      ],
    });

    expect(
      RoadmapTurnContext.renderRoadmapContext(
        feature,
        byIdOf(objective, epic, openBlocker, doneBlocker, feature),
      ),
    ).toBe(
      [
        "Roadmap work item for this thread (Lathe roadmap, refreshed each turn):",
        'Feature "Build-time brand layer" (id feature), state In progress, priority P1, due 2026-10-23.',
        "Parent: Lathe is my daily driver > Rebrand to Lathe.",
        "Acceptance criteria:",
        "[x] Brand tokens resolve at build time",
        "[ ] Windows installer art uses the channel name",
        'Blocked by: Feature "Icon set" (In progress), "Waiting on the signing cert" (external).',
        "Use lathe_roadmap_read for criterion ids, and the lathe_roadmap_* tools to tick criteria with evidence or update this item.",
      ].join("\n"),
    );
  });

  it("says when a top-level item has no due date, criteria or blockers", () => {
    const item = workItem("root", { type: "objective", title: "Ship it" });
    const rendered = RoadmapTurnContext.renderRoadmapContext(item, byIdOf(item));
    expect(rendered).toContain(
      'Objective "Ship it" (id root), state Backlog, priority P2, no due date.',
    );
    expect(rendered).not.toContain("Parent:");
    expect(rendered).toContain("Acceptance criteria: none yet.");
    expect(rendered).toContain("Blocked by: nothing.");
  });

  it("stays under the cap by listing the first criteria and counting the rest", () => {
    const item = workItem("long", {
      criteria: Array.from({ length: 60 }, (_, index) =>
        criterion(`c${index}`, `Criterion number ${index} with some explanatory words`),
      ),
    });
    const rendered = RoadmapTurnContext.renderRoadmapContext(item, byIdOf(item));
    expect(rendered.length).toBeLessThanOrEqual(RoadmapTurnContext.ROADMAP_CONTEXT_MAX_CHARS);
    expect(rendered).toContain("[ ] Criterion number 0 with some explanatory words");
    expect(rendered).not.toContain("Criterion number 59");
    expect(rendered).toMatch(/\.\.\. and \d+ more criteria\./);
    expect(rendered).toMatch(/update this item\.$/);
  });

  it("shortens a very long title instead of dropping the footer", () => {
    const item = workItem("wordy", { title: "word ".repeat(1_000).trim() });
    const rendered = RoadmapTurnContext.renderRoadmapContext(item, byIdOf(item));
    expect(rendered.length).toBeLessThanOrEqual(RoadmapTurnContext.ROADMAP_CONTEXT_MAX_CHARS);
    expect(rendered).toMatch(/update this item\.$/);
  });
});

const roadmapLayer = (homeEnvironmentId: EnvironmentId | null) =>
  RoadmapService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        ServerSettingsService.layerTest({ roadmap: { homeEnvironmentId } }),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
        }),
      ),
    ),
    Layer.provide(Layer.fresh(SqlitePersistence.layerMemory)),
  );

const turnContextLayer = <E>(roadmap: Layer.Layer<RoadmapService.RoadmapService, E>) =>
  RoadmapTurnContext.layer.pipe(
    Layer.provideMerge(roadmap),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
      }),
    ),
  );

const create = (itemId: string, attach: boolean): RoadmapCommand => ({
  type: "roadmap.item.create",
  commandId: CommandId.make(`create-${itemId}`),
  itemId: RoadmapItemId.make(itemId),
  itemType: "story",
  title: `Story ${itemId}`,
  ...(attach ? { attachThread: { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID } } : {}),
});

describe("RoadmapTurnContext.forThread", () => {
  it.effect("renders the attached item on the roadmap home", () =>
    Effect.gen(function* () {
      const roadmap = yield* RoadmapService.RoadmapService;
      yield* roadmap.dispatch(create("other", false), user);
      yield* roadmap.dispatch(create("mine", true), user);
      const block = yield* (yield* RoadmapTurnContext.RoadmapTurnContext).forThread(THREAD_ID);
      expect(block).toContain('Story "Story mine" (id mine)');
    }).pipe(Effect.provide(turnContextLayer(roadmapLayer(null)))),
  );

  it.effect("is empty for a thread with no work item", () =>
    Effect.gen(function* () {
      const roadmap = yield* RoadmapService.RoadmapService;
      yield* roadmap.dispatch(create("other", false), user);
      expect(yield* (yield* RoadmapTurnContext.RoadmapTurnContext).forThread(THREAD_ID)).toBe("");
    }).pipe(Effect.provide(turnContextLayer(roadmapLayer(null)))),
  );

  it.effect("is empty off the roadmap home", () =>
    Effect.gen(function* () {
      expect(yield* (yield* RoadmapTurnContext.RoadmapTurnContext).forThread(THREAD_ID)).toBe("");
    }).pipe(Effect.provide(turnContextLayer(roadmapLayer(EnvironmentId.make("environment-home"))))),
  );

  it.effect("is empty when the roadmap cannot be read or the read dies", () =>
    Effect.gen(function* () {
      const failing = turnContextLayer(
        Layer.mock(RoadmapService.RoadmapService)({
          isHome: Effect.succeed(true),
          forThread: () => Effect.fail(new RoadmapError({ code: "internal", message: "down" })),
        }),
      );
      const dying = turnContextLayer(
        Layer.mock(RoadmapService.RoadmapService)({
          isHome: Effect.die(new Error("settings exploded")),
        }),
      );
      for (const roadmap of [failing, dying]) {
        const block = yield* RoadmapTurnContext.RoadmapTurnContext.pipe(
          Effect.flatMap((context) => context.forThread(THREAD_ID)),
          Effect.provide(roadmap),
        );
        expect(block).toBe("");
      }
    }),
  );
});
