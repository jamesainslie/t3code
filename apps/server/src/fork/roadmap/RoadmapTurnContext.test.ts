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
import * as RoadmapContextBlock from "./RoadmapContextBlock.ts";
import type * as RoadmapProgress from "./RoadmapProgress.ts";
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
      RoadmapContextBlock.renderRoadmapContext(
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
    const rendered = RoadmapContextBlock.renderRoadmapContext(item, byIdOf(item));
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
    const rendered = RoadmapContextBlock.renderRoadmapContext(item, byIdOf(item));
    expect(rendered.length).toBeLessThanOrEqual(RoadmapContextBlock.ROADMAP_CONTEXT_MAX_CHARS);
    expect(rendered).toContain("[ ] Criterion number 0 with some explanatory words");
    expect(rendered).not.toContain("Criterion number 59");
    expect(rendered).toMatch(/\.\.\. and \d+ more criteria\./);
    expect(rendered).toMatch(/update this item\.$/);
  });

  it("shortens a very long title instead of dropping the footer", () => {
    const item = workItem("wordy", { title: "word ".repeat(1_000).trim() });
    const rendered = RoadmapContextBlock.renderRoadmapContext(item, byIdOf(item));
    expect(rendered.length).toBeLessThanOrEqual(RoadmapContextBlock.ROADMAP_CONTEXT_MAX_CHARS);
    expect(rendered).toMatch(/update this item\.$/);
  });
});

describe("renderRoadmapContext progress line", () => {
  const progress = (
    fields: Partial<RoadmapProgress.RoadmapItemProgress> = {},
  ): RoadmapProgress.RoadmapItemProgress => ({
    unit: "points",
    burned: 6,
    remaining: 4,
    total: 10,
    velocity: null,
    forecast: { status: "at-risk", projected: "2026-10-23", slackDays: 0 },
    ...fields,
  });

  it("puts the forecast and progress right after the state line", () => {
    const parent = workItem("parent", { type: "epic", title: "Roadmap" });
    const item = workItem("feature", { parentId: parent.id, dueDate: "2026-10-23" });
    const lines = RoadmapContextBlock.renderRoadmapContext(
      item,
      byIdOf(parent, item),
      progress(),
    ).split("\n");
    expect(lines[1]).toContain("state Backlog");
    expect(lines[2]).toBe("Forecast: At risk, projected 2026-10-23; 6 of 10 pts done.");
    expect(lines[3]).toBe("Parent: Roadmap.");
  });

  it("shows progress alone when there is no forecast, in the area's unit", () => {
    const item = workItem("feature");
    const rendered = RoadmapContextBlock.renderRoadmapContext(
      item,
      byIdOf(item),
      progress({
        unit: "hours",
        burned: 3.25,
        remaining: null,
        total: null,
        forecast: { status: "no-forecast", projected: null, slackDays: null },
      }),
    );
    expect(rendered.split("\n")[2]).toBe("Progress: 3.3 hours done.");
  });

  it("leaves the line out with no forecast and nothing done", () => {
    const item = workItem("feature");
    const rendered = RoadmapContextBlock.renderRoadmapContext(
      item,
      byIdOf(item),
      progress({
        burned: 0,
        forecast: { status: "no-forecast", projected: null, slackDays: null },
      }),
    );
    expect(rendered).toBe(RoadmapContextBlock.renderRoadmapContext(item, byIdOf(item)));
    expect(rendered).not.toMatch(/^(Forecast|Progress):/m);
  });

  it("keeps the cap with the line present", () => {
    const item = workItem("long", {
      title: "word ".repeat(1_000).trim(),
      criteria: Array.from({ length: 60 }, (_, index) =>
        criterion(`c${index}`, `Criterion number ${index} with some explanatory words`),
      ),
    });
    const rendered = RoadmapContextBlock.renderRoadmapContext(
      item,
      byIdOf(item),
      progress({ forecast: { status: "late", projected: "2026-11-02", slackDays: -3 } }),
    );
    expect(rendered.length).toBeLessThanOrEqual(RoadmapContextBlock.ROADMAP_CONTEXT_MAX_CHARS);
    expect(rendered).toContain("Forecast: Late, projected 2026-11-02; 6 of 10 pts done.");
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
      Layer.mergeAll(
        // Area settings at their defaults: points, Monday to Friday.
        ServerSettingsService.layerTest(),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
        }),
      ),
    ),
  );

const create = (
  itemId: string,
  attach: boolean,
  fields: Partial<RoadmapCommand> = {},
): RoadmapCommand =>
  ({
    type: "roadmap.item.create",
    commandId: CommandId.make(`create-${itemId}`),
    itemId: RoadmapItemId.make(itemId),
    itemType: "story",
    title: `Story ${itemId}`,
    ...(attach ? { attachThread: { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID } } : {}),
    ...fields,
  }) as RoadmapCommand;

describe("RoadmapTurnContext.forThread", () => {
  it.effect("renders the attached item on the roadmap home", () =>
    Effect.gen(function* () {
      const roadmap = yield* RoadmapService.RoadmapService;
      yield* roadmap.dispatch(create("other", false), user);
      yield* roadmap.dispatch(create("mine", true), user);
      const block = yield* (yield* RoadmapTurnContext.RoadmapTurnContext).forThread(THREAD_ID);
      expect(block).toContain('Story "Story mine" (id mine)');
      expect(block).not.toMatch(/^(Forecast|Progress):/m);
    }).pipe(Effect.provide(turnContextLayer(roadmapLayer(null)))),
  );

  it.effect("adds the forecast from the area's velocity, dated in UTC", () =>
    Effect.gen(function* () {
      const roadmap = yield* RoadmapService.RoadmapService;
      // The test clock starts at 1970-01-01, a Thursday, so these finish today.
      for (const index of [1, 2, 3, 4, 5]) {
        yield* roadmap.dispatch(
          create(`done-${index}`, false, { state: "done", estimate: 3 } as Partial<RoadmapCommand>),
          user,
        );
      }
      yield* roadmap.dispatch(
        create("mine", true, { estimate: 4, dueDate: "1970-01-07" } as Partial<RoadmapCommand>),
        user,
      );
      const block = yield* (yield* RoadmapTurnContext.RoadmapTurnContext).forThread(THREAD_ID);
      expect(block.split("\n")[2]).toBe(
        "Forecast: At risk, projected 1970-01-07; 0 of 4 pts done.",
      );
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
          threadContext: () => Effect.fail(new RoadmapError({ code: "internal", message: "down" })),
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
