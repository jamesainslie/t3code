import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProviderInstanceId,
  type RoadmapCommand,
  RoadmapError,
  type RoadmapImportIssueInput,
  RoadmapItemId,
  ThreadId,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as RoadmapGitHubSync from "../../../fork/roadmap/RoadmapGitHubSync.ts";
import * as RoadmapLinkTestkit from "../../../fork/roadmap/RoadmapLink.testkit.ts";
import * as RoadmapLinkOutbox from "../../../fork/roadmap/RoadmapLinkOutbox.ts";
import * as RoadmapService from "../../../fork/roadmap/RoadmapService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as RoadmapHandlers from "./handlers.ts";
import { RoadmapToolkit } from "./tools.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");
const MISSING_THREAD_ID = ThreadId.make("thread-missing");
const callerRef = { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID };
const user = { _tag: "user" } as const;

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: ENVIRONMENT_ID,
  capabilities: new Set(capabilities),
  issuedAt: 1,
  requestNamespace: "provider-session-1",
  thread: {
    threadId: THREAD_ID,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
});

const roadmapLayer = (homeEnvironmentId: EnvironmentId | null) =>
  RoadmapService.layer.pipe(
    // The handlers read area settings too.
    Layer.provideMerge(
      Layer.mergeAll(
        RoadmapLinkTestkit.layerNotLinked,
        IdAllocator.layer,
        ServerSettingsService.layerTest({ roadmap: { homeEnvironmentId } }),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
        }),
      ),
    ),
    Layer.provide(Layer.fresh(SqlitePersistence.layerMemory)),
  );

const threadsLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
  getThreadShell: (threadId) =>
    Effect.succeed(
      threadId === MISSING_THREAD_ID ? null : McpToolAccessTestkit.liveThreadShell(threadId),
    ),
});

/** Imports asked of GitHub sync, which answers as the home would. */
const imports: Array<RoadmapImportIssueInput> = [];
const githubSyncLayer = Layer.mock(RoadmapGitHubSync.RoadmapGitHubSync)({
  importIssue: (input) =>
    Effect.sync(() => imports.push(input)).pipe(
      Effect.andThen(
        input.url.endsWith("/404")
          ? Effect.fail(new RoadmapError({ code: "not_found", message: "No such issue." }))
          : Effect.succeed({ itemId: RoadmapItemId.make("imported"), imported: 3 }),
      ),
    ),
});

type Tools = typeof RoadmapToolkit.tools;

const makeHarness = Effect.fn("makeRoadmapToolkitHarness")(function* (
  options: {
    readonly homeEnvironmentId?: EnvironmentId | null;
    /** Runs this environment off the home, linked to the given home. */
    readonly linkedTo?: RoadmapLinkTestkit.InProcessHome;
  } = {},
) {
  const dependencies = Layer.mergeAll(
    threadsLayer,
    NodeCrypto.layer,
    githubSyncLayer,
    options.linkedTo === undefined
      ? roadmapLayer(options.homeEnvironmentId ?? null)
      : RoadmapLinkTestkit.layerLinkedEnvironment(options.linkedTo, {
          environmentId: ENVIRONMENT_ID,
          homeEnvironmentId: EnvironmentId.make("environment-home"),
        }),
  );
  const services = yield* Layer.build(dependencies);
  if (options.linkedTo !== undefined) {
    yield* RoadmapLinkOutbox.runWorker.pipe(Effect.provideContext(services), Effect.forkScoped);
    yield* RoadmapService.RoadmapService.pipe(
      Effect.flatMap((roadmap) =>
        Effect.gen(function* () {
          yield* roadmap.configureLink({
            homeUrl: RoadmapLinkTestkit.HOME_URL,
            credential: yield* options.linkedTo!.linkGrant(ENVIRONMENT_ID),
          });
        }),
      ),
      Effect.provideContext(services),
    );
  }
  const toolkit = yield* RoadmapToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(RoadmapHandlers.layer).pipe(
        Layer.provide(Layer.succeedContext(services)),
      ),
    ),
  );
  const call = <Name extends keyof Tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["roadmap"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the success shape.
      Effect.map((chunk) => chunk.at(-1)!.result as Tool.Success<Tools[Name]>),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provideContext(services),
    );
  const roadmap = yield* RoadmapService.RoadmapService.pipe(Effect.provideContext(services));
  const userDispatch = (command: RoadmapCommand) => roadmap.dispatch(command, user);
  return { call, roadmap, userDispatch };
});

const createAsUser = (itemId: string, fields: Partial<RoadmapCommand> = {}): RoadmapCommand =>
  ({
    type: "roadmap.item.create",
    commandId: CommandId.make(`user-create-${itemId}`),
    itemId: RoadmapItemId.make(itemId),
    itemType: "feature",
    title: `Feature ${itemId}`,
    ...fields,
  }) as RoadmapCommand;

describe("roadmap toolkit handlers", () => {
  it.effect("refuses a credential without the roadmap capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("lathe_roadmap_list", {}, ["document-comments"])
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "roadmap",
        threadId: THREAD_ID,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("creates an item as the calling agent, marked for review and attached on request", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const created = yield* harness.call("lathe_roadmap_create", {
        type: "story",
        title: "Write the roadmap tools",
        criteria: ["Tools are registered", "Tests pass"],
        attachCaller: true,
      });
      const item = Option.getOrThrow(yield* harness.roadmap.get(created.itemId));
      expect(item).toMatchObject({
        type: "story",
        title: "Write the roadmap tools",
        needsReview: true,
        origin: callerRef,
        createdBy: { _tag: "agent", thread: callerRef, threadTitle: THREAD_ID },
        attachments: [{ thread: callerRef }],
      });
      expect(item.criteria.map((criterion) => criterion.text)).toEqual([
        "Tools are registered",
        "Tests pass",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("creates one item for a retried clientRequestId", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const input = { type: "bug", title: "Flaky retry", clientRequestId: "create-1" } as const;
      const first = yield* harness.call("lathe_roadmap_create", input);
      const second = yield* harness.call("lathe_roadmap_create", input);
      expect(second.itemId).toBe(first.itemId);
      expect((yield* harness.roadmap.list()).map((item) => item.id)).toEqual([first.itemId]);
    }).pipe(Effect.scoped),
  );

  it.effect("reads the caller's attached item by default, with its parents and history", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(
        createAsUser("epic", { itemType: "epic", title: "Roadmap" } as Partial<RoadmapCommand>),
      );
      yield* harness.userDispatch(
        createAsUser("feature", {
          parentId: RoadmapItemId.make("epic"),
          attachThread: callerRef,
        } as Partial<RoadmapCommand>),
      );
      const read = yield* harness.call("lathe_roadmap_read", {});
      expect(read.item.id).toBe("feature");
      expect(read.parents).toEqual([{ id: "epic", type: "epic", title: "Roadmap" }]);
      expect(read.effectivePriority).toBe("p2");
      expect(read.history.map((entry) => entry.type)).toEqual(["roadmap.item.created"]);

      const named = yield* harness.call("lathe_roadmap_read", {
        itemId: RoadmapItemId.make("epic"),
      });
      expect(named.item.title).toBe("Roadmap");
    }).pipe(Effect.scoped),
  );

  it.effect("reads the forecast, burn and velocity in the area's unit, and lists the status", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      // The test clock starts at 1970-01-01, a Thursday, so these finish today.
      for (const index of [1, 2, 3, 4, 5]) {
        yield* harness.userDispatch(
          createAsUser(`done-${index}`, { state: "done", estimate: 3 } as Partial<RoadmapCommand>),
        );
      }
      yield* harness.userDispatch(
        createAsUser("feature", {
          estimate: 4,
          dueDate: "1970-01-07",
          attachThread: callerRef,
        } as Partial<RoadmapCommand>),
      );

      const read = yield* harness.call("lathe_roadmap_read", {});
      // 15 points over 15 working days is 1 a day, so 4 points land on Wednesday, the due date.
      expect(read).toMatchObject({
        unit: "points",
        burned: 0,
        remaining: 4,
        velocity: { perDay: 1, sampleSize: 5 },
        forecast: { status: "at-risk", projected: "1970-01-07" },
      });
      const done = yield* harness.call("lathe_roadmap_read", {
        itemId: RoadmapItemId.make("done-1"),
      });
      expect(done).toMatchObject({
        burned: 3,
        remaining: 0,
        forecast: { status: "no-forecast", projected: null },
      });

      const list = yield* harness.call("lathe_roadmap_list", {});
      expect(list.items.find((row) => row.id === "feature")?.forecast).toBe("at-risk");
      expect(list.items.find((row) => row.id === "done-1")?.forecast).toBe("no-forecast");
    }).pipe(Effect.scoped),
  );

  it.effect("reports no velocity under five finished items", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(
        createAsUser("feature", { estimate: 2, attachThread: callerRef } as never),
      );
      const read = yield* harness.call("lathe_roadmap_read", {});
      expect(read).toMatchObject({
        unit: "points",
        burned: 0,
        remaining: 2,
        velocity: null,
        forecast: { status: "no-forecast", projected: null },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("logs hours on the attached item as the calling agent, once per clientRequestId", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature", { attachThread: callerRef } as never));
      yield* harness.userDispatch(createAsUser("other"));
      const feature = RoadmapItemId.make("feature");

      const input = { hours: 1.5, note: "Wrote the tool", clientRequestId: "hours-1" };
      const first = yield* harness.call("lathe_roadmap_log_hours", input);
      const retried = yield* harness.call("lathe_roadmap_log_hours", input);
      expect(retried).toEqual(first);
      expect(first).toMatchObject({ itemId: feature, totalHours: 1.5 });

      const second = yield* harness.call("lathe_roadmap_log_hours", { hours: 2 });
      expect(second.entryId).not.toBe(first.entryId);
      expect(second).toMatchObject({ totalHours: 3.5 });

      const item = Option.getOrThrow(yield* harness.roadmap.get(feature));
      expect(item.hours).toHaveLength(2);
      expect(item.hours[0]).toMatchObject({
        id: first.entryId,
        hours: 1.5,
        note: "Wrote the tool",
        actor: { _tag: "agent", thread: callerRef, threadTitle: THREAD_ID },
      });
      expect(item.hours[1]).toMatchObject({ hours: 2, note: null });

      yield* harness.call("lathe_roadmap_log_hours", {
        itemId: RoadmapItemId.make("other"),
        hours: 0.25,
      });
      const other = Option.getOrThrow(yield* harness.roadmap.get(RoadmapItemId.make("other")));
      expect(other.hours.map((entry) => entry.hours)).toEqual([0.25]);
    }).pipe(Effect.scoped),
  );

  it.effect("adds a progress note on the attached item as the calling agent, once per retry", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature", { attachThread: callerRef } as never));
      yield* harness.userDispatch(createAsUser("other"));
      const feature = RoadmapItemId.make("feature");

      const input = { text: "Wired the retry path", clientRequestId: "note-1" };
      const first = yield* harness.call("lathe_roadmap_add_note", input);
      const retried = yield* harness.call("lathe_roadmap_add_note", input);
      expect(retried).toEqual(first);
      expect(first).toMatchObject({ itemId: feature, sequence: expect.any(Number) });

      const item = Option.getOrThrow(yield* harness.roadmap.get(feature));
      expect(item.progressNotes).toEqual([
        {
          id: first.noteId,
          at: expect.any(String),
          actor: { _tag: "agent", thread: callerRef, threadTitle: THREAD_ID },
          kind: "progress",
          text: "Wired the retry path",
          criterionId: null,
        },
      ]);

      yield* harness.call("lathe_roadmap_add_note", {
        itemId: RoadmapItemId.make("other"),
        text: "Unblocked by the release",
      });
      const other = Option.getOrThrow(yield* harness.roadmap.get(RoadmapItemId.make("other")));
      expect(other.progressNotes.map((note) => note.text)).toEqual(["Unblocked by the release"]);
    }).pipe(Effect.scoped),
  );

  it.effect("imports a GitHub issue through GitHub sync and reports its refusals", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      imports.length = 0;
      const result = yield* harness.call("lathe_roadmap_import_issue", {
        url: "https://github.com/acme/web/issues/12",
        area: "work",
      });
      expect(result).toEqual({ itemId: "imported", imported: 3 });
      expect(imports).toEqual([{ url: "https://github.com/acme/web/issues/12", area: "work" }]);

      const error = yield* harness
        .call("lathe_roadmap_import_issue", { url: "https://github.com/acme/web/issues/404" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "RoadmapToolFailure", code: "not_found" });
    }).pipe(Effect.scoped),
  );

  it.effect("links a pull request to the attached item as the calling agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature", { attachThread: callerRef } as never));
      const feature = RoadmapItemId.make("feature");
      const result = yield* harness.call("lathe_roadmap_link_pull_request", {
        url: "https://github.com/Acme/Web/pull/7",
      });
      expect(result).toMatchObject({ itemId: feature, sequence: expect.any(Number) });
      const item = Option.getOrThrow(yield* harness.roadmap.get(feature));
      expect(item.pullRequests).toEqual([
        {
          host: "github.com",
          repository: "acme/web",
          number: 7,
          url: "https://github.com/Acme/Web/pull/7",
        },
      ]);

      const notPullRequest = yield* harness
        .call("lathe_roadmap_link_pull_request", { url: "https://github.com/acme/web/issues/7" })
        .pipe(Effect.flip);
      expect(notPullRequest).toMatchObject({ _tag: "RoadmapToolFailure", code: "invalid_request" });
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a note for a caller with no work item", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("lathe_roadmap_add_note", { text: "Lost" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "RoadmapToolFailure", code: "not_attached" });
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to log hours for a caller with no work item", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call("lathe_roadmap_log_hours", { hours: 1 }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "RoadmapToolFailure", code: "not_attached" });
    }).pipe(Effect.scoped),
  );

  it.effect("asks for an item id when the caller is not attached", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call("lathe_roadmap_read", {}).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "RoadmapToolFailure", code: "not_attached" });
      expect(error.message).toContain("not_attached");
    }).pipe(Effect.scoped),
  );

  it.effect("lists compact rows filtered by type, state and subtree", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(
        createAsUser("epic", { itemType: "epic", title: "Roadmap" } as Partial<RoadmapCommand>),
      );
      yield* harness.userDispatch(
        createAsUser("child", {
          parentId: RoadmapItemId.make("epic"),
          state: "in-progress",
          criteria: [{ text: "One" }, { text: "Two" }],
        } as Partial<RoadmapCommand>),
      );
      yield* harness.userDispatch(createAsUser("loose"));

      const all = yield* harness.call("lathe_roadmap_list", {});
      expect(all.items.map((row) => row.id)).toEqual(
        expect.arrayContaining(["epic", "child", "loose"]),
      );
      const child = all.items.find((row) => row.id === "child");
      expect(child).toEqual({
        id: "child",
        type: "feature",
        title: "Feature child",
        state: "in-progress",
        priority: "p2",
        area: "personal",
        parentId: "epic",
        dueDate: null,
        criteriaTicked: 0,
        criteriaTotal: 2,
        attachedThreads: 0,
        needsReview: false,
        forecast: "no-forecast",
      });
      const features = yield* harness.call("lathe_roadmap_list", { type: "feature" });
      expect(features.items.map((row) => row.id).sort()).toEqual(["child", "loose"]);
      const inProgress = yield* harness.call("lathe_roadmap_list", { state: "in-progress" });
      expect(inProgress.items.map((row) => row.id)).toEqual(["child"]);
      const under = yield* harness.call("lathe_roadmap_list", {
        underItemId: RoadmapItemId.make("epic"),
      });
      expect(under.items.map((row) => row.id)).toEqual(["child"]);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses done while criteria are open and allows it once they are ticked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(
        createAsUser("feature", {
          attachThread: callerRef,
          criteria: [{ id: "c1", text: "It works" }],
        } as Partial<RoadmapCommand>),
      );
      const refused = yield* harness
        .call("lathe_roadmap_update", { state: "done" })
        .pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "RoadmapToolFailure", code: "open_criteria" });
      expect(refused.message).toContain("It works");

      yield* harness.call("lathe_roadmap_criterion_tick", {
        criterionId: "c1",
        ticked: true,
        evidence: "The test suite passes.",
      });
      yield* harness.call("lathe_roadmap_update", { state: "done", title: "Shipped" });
      const item = Option.getOrThrow(yield* harness.roadmap.get(RoadmapItemId.make("feature")));
      expect(item).toMatchObject({ state: "done", title: "Shipped" });
      expect(item.criteria[0]).toMatchObject({
        evidence: "The test suite passes.",
        tickedBy: { _tag: "agent", thread: callerRef },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("refuses an update with nothing to change", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature"));
      const error = yield* harness
        .call("lathe_roadmap_update", { itemId: RoadmapItemId.make("feature") })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "invalid_request" });
    }).pipe(Effect.scoped),
  );

  it.effect("attaches and detaches the caller or a named thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature"));
      const feature = RoadmapItemId.make("feature");
      yield* harness.call("lathe_roadmap_attach", { itemId: feature });
      yield* harness.call("lathe_roadmap_attach", { itemId: feature, threadId: OTHER_THREAD_ID });
      const attached = Option.getOrThrow(yield* harness.roadmap.get(feature));
      expect(attached.attachments.map((attachment) => attachment.thread.threadId).sort()).toEqual([
        THREAD_ID,
        OTHER_THREAD_ID,
      ]);

      yield* harness.call("lathe_roadmap_detach", {});
      yield* harness.call("lathe_roadmap_detach", { threadId: OTHER_THREAD_ID });
      expect(Option.getOrThrow(yield* harness.roadmap.get(feature)).attachments).toEqual([]);

      const missing = yield* harness
        .call("lathe_roadmap_attach", { itemId: feature, threadId: MISSING_THREAD_ID })
        .pipe(Effect.flip);
      expect(missing).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "thread_not_found" });
    }).pipe(Effect.scoped),
  );

  it.effect("carries the rejection code in the failure message", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("first", { attachThread: callerRef } as never));
      yield* harness.userDispatch(createAsUser("second"));
      const error = yield* harness
        .call("lathe_roadmap_attach", { itemId: RoadmapItemId.make("second") })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "RoadmapToolFailure", code: "already_attached" });
      expect(error.message).toMatch(/^already_attached: /);
    }).pipe(Effect.scoped),
  );

  it.effect("links and unlinks a blocker on the attached item", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.userDispatch(createAsUser("feature", { attachThread: callerRef } as never));
      yield* harness.userDispatch(createAsUser("blocker"));
      const blocker = RoadmapItemId.make("blocker");
      const feature = RoadmapItemId.make("feature");
      yield* harness.call("lathe_roadmap_link_blocker", { blockedById: blocker, linked: true });
      expect(Option.getOrThrow(yield* harness.roadmap.get(feature)).blockedBy).toEqual([blocker]);
      yield* harness.call("lathe_roadmap_link_blocker", { blockedById: blocker, linked: false });
      expect(Option.getOrThrow(yield* harness.roadmap.get(feature)).blockedBy).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("surfaces a roadmap home on another environment as a clear failure", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        homeEnvironmentId: EnvironmentId.make("environment-home"),
      });
      const read = yield* harness.call("lathe_roadmap_list", {}).pipe(Effect.flip);
      expect(read).toMatchObject({ _tag: "RoadmapToolFailure", code: "roadmap_home_elsewhere" });
      expect(read.message).toMatch(/^roadmap_home_elsewhere: /);
      const write = yield* harness
        .call("lathe_roadmap_create", { type: "story", title: "Nowhere" })
        .pipe(Effect.flip);
      expect(write).toMatchObject({ code: "roadmap_home_elsewhere" });
    }).pipe(Effect.scoped),
  );

  it.effect("reads and changes the home's roadmap from an environment linked to it", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const harness = yield* makeHarness({ linkedTo: home });
      const created = yield* harness.call("lathe_roadmap_create", {
        type: "feature",
        title: "From the laptop",
        criteria: ["Ships"],
        attachCaller: true,
      });
      expect(created).toMatchObject({ itemId: expect.any(String), sequence: expect.any(Number) });
      expect("queued" in created).toBe(false);

      const read = yield* harness.call("lathe_roadmap_read", {});
      expect(read.item).toMatchObject({ id: created.itemId, title: "From the laptop" });
      expect(read.item.createdBy).toMatchObject({ _tag: "agent", thread: callerRef });
      const listed = yield* harness.call("lathe_roadmap_list", {});
      expect(listed.items.map((row) => row.id)).toEqual([created.itemId]);

      const logged = yield* harness.call("lathe_roadmap_log_hours", { hours: 2 });
      expect(logged).toMatchObject({ itemId: created.itemId, totalHours: 2 });
      const onHome = Option.getOrThrow(yield* home.roadmap.get(created.itemId));
      expect(onHome.hours.map((entry) => entry.hours)).toEqual([2]);
    }).pipe(Effect.scoped),
  );

  it.effect("queues a change for a named item while the home cannot be reached", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const harness = yield* makeHarness({ linkedTo: home });
      const created = yield* harness.call("lathe_roadmap_create", {
        type: "feature",
        title: "Queue me",
        criteria: ["One"],
      });
      const [criterion] = Option.getOrThrow(yield* home.roadmap.get(created.itemId)).criteria;
      home.setReachable(false);

      const ticked = yield* harness.call("lathe_roadmap_criterion_tick", {
        itemId: created.itemId,
        criterionId: criterion!.id,
        ticked: true,
        evidence: "Merged",
      });
      expect(ticked).toEqual({ itemId: created.itemId, queued: true });
      const logged = yield* harness.call("lathe_roadmap_log_hours", {
        itemId: created.itemId,
        hours: 1,
      });
      expect(logged).toMatchObject({ itemId: created.itemId, queued: true });
      expect("totalHours" in logged).toBe(false);
      expect((yield* harness.roadmap.linkStatus).queued).toBe(2);

      // The thread's own item needs the home to say which it is.
      const attached = yield* harness
        .call("lathe_roadmap_log_hours", { hours: 1 })
        .pipe(Effect.flip);
      expect(attached).toMatchObject({ _tag: "RoadmapToolFailure", code: "internal" });
    }).pipe(Effect.scoped),
  );
});
