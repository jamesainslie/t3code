import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  MessageId,
  type OrchestrationProject,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "../orchestration/decider.ts";
import { projectEvent } from "../orchestration/projector.ts";
import { createEmptyReadModel } from "../orchestration/projector.ts";
import { planImport } from "./Planner.ts";

const at = "2026-09-07T00:00:00Z";
const project: OrchestrationProject = {
  id: ProjectId.make("upstream-project"),
  title: "Upstream",
  workspaceRoot: "/example",
  defaultModelSelection: null,
  scripts: [],
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
};

it("preserves settings on a matched fork project", () => {
  const local = { ...project, id: ProjectId.make("local-project"), title: "My fork title" };
  const plan = planImport({
    source: {
      version: 1,
      sourceHome: "/source",
      sourceId: "source-id",
      contentHash: "content",
      projects: [{ project, threads: [], warnings: [] }],
    },
    snapshot: { ...createEmptyReadModel(at), projects: [local] },
    history: [],
    mappings: [{ sourceProjectId: project.id, projectId: local.id }],
    batchId: "batch-1",
    now: at,
  });
  expect(plan.record.mappings[0]?.projectId).toBe(local.id);
  expect(plan.commands).toEqual([]);
  expect(plan.record.projectChanges).toEqual([]);
});

it.effect("allows an explicit separate imported project at an existing workspace", () =>
  Effect.gen(function* () {
    const local = { ...project, id: ProjectId.make("local") };
    const snapshot = { ...createEmptyReadModel(at), projects: [local] };
    const plan = planImport({
      source: {
        version: 1,
        sourceHome: "/source",
        sourceId: "source",
        contentHash: "content",
        projects: [{ project, threads: [], warnings: [] }],
      },
      snapshot,
      history: [],
      mappings: [{ sourceProjectId: project.id, projectId: ProjectId.make("separate") }],
      batchId: "separate",
      now: at,
    });
    const events = yield* decideOrchestrationCommand({ command: plan, readModel: snapshot }).pipe(
      Effect.provide(NodeServices.layer),
    );
    expect(Array.isArray(events) && events.some((event) => event.type === "project.created")).toBe(
      true,
    );
  }),
);

it("keeps a local title override across successive upstream setting updates", () => {
  const local = { ...project, title: "My title", autoPull: false };
  const history = [
    {
      id: "first",
      sourceId: "source-id",
      sourceHome: "/source",
      createdAt: at,
      parentId: null,
      undoBatchId: null,
      contentHash: "old",
      mappings: [],
      visibleThreadIds: [],
      hiddenThreadIds: [],
      projectChanges: [
        {
          before: null,
          after: { ...project, autoPull: false },
          ownedSettings: ["title", "autoPull"],
        },
      ],
    },
  ];
  const source = {
    version: 1 as const,
    sourceHome: "/source",
    sourceId: "source-id",
    contentHash: "new",
    projects: [
      {
        project: { ...project, title: "Upstream renamed", autoPull: true },
        threads: [],
        warnings: [],
      },
    ],
  };
  const mappings = [{ sourceProjectId: project.id, projectId: project.id }];
  const first = planImport({
    source,
    snapshot: { ...createEmptyReadModel(at), projects: [local] },
    history,
    mappings,
    batchId: "second",
    now: at,
  });
  const after = first.record.projectChanges[0]!.after;
  expect(after.title).toBe("My title");
  expect(after.autoPull).toBe(true);
  const second = planImport({
    source: {
      ...source,
      projects: [
        {
          ...source.projects[0]!,
          project: { ...source.projects[0]!.project, title: "Another rename", autoPull: false },
        },
      ],
    },
    snapshot: { ...createEmptyReadModel(at), projects: [after] },
    history: [first.record, ...history],
    mappings,
    batchId: "third",
    now: at,
  });
  expect(second.record.projectChanges[0]!.after.title).toBe("My title");
});

it("preserves an explicit local setting even when its value still matches the last import", () => {
  const history = [
    {
      id: "first",
      sourceId: "source",
      sourceHome: "/source",
      createdAt: at,
      parentId: null,
      undoBatchId: null,
      contentHash: "old",
      mappings: [],
      visibleThreadIds: [],
      hiddenThreadIds: [],
      projectChanges: [{ before: null, after: project }],
    },
  ];
  const plan = planImport({
    source: {
      version: 1,
      sourceHome: "/source",
      sourceId: "source",
      contentHash: "new",
      projects: [{ project: { ...project, title: "Renamed" }, threads: [], warnings: [] }],
    },
    snapshot: { ...createEmptyReadModel(at), projects: [project] },
    history,
    mappings: [{ sourceProjectId: project.id, projectId: project.id }],
    localSettingOverrides: new Map([[project.id, new Set(["title"])]]),
    batchId: "second",
    now: at,
  });
  expect(plan.commands).toEqual([]);
});

it.effect(
  "imports a new project and history, then plans no duplicate work on the same source",
  () =>
    Effect.gen(function* () {
      const source = {
        version: 1 as const,
        sourceHome: "/source",
        sourceId: "source-id",
        contentHash: "content",
        projects: [
          {
            project,
            warnings: [],
            threads: [
              {
                id: ThreadId.make("upstream-thread"),
                projectId: project.id,
                title: "A conversation",
                modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
                runtimeMode: "full-access" as const,
                interactionMode: "default" as const,
                branch: null,
                worktreePath: null,
                latestTurn: null,
                session: null,
                createdAt: at,
                updatedAt: at,
                archivedAt: null,
                deletedAt: null,
                settledOverride: null,
                settledAt: null,
                activities: [],
                proposedPlans: [],
                checkpoints: [],
                messages: [
                  {
                    id: MessageId.make("upstream-message"),
                    role: "user" as const,
                    text: "Existing question",
                    turnId: null,
                    streaming: false,
                    createdAt: at,
                    updatedAt: at,
                  },
                ],
              },
            ],
          },
        ],
      };
      const snapshot = createEmptyReadModel(at);
      const mappings = [{ sourceProjectId: project.id, projectId: ProjectId.make("new-project") }];
      const first = planImport({
        source,
        snapshot,
        history: [],
        mappings,
        batchId: "first",
        now: at,
      });
      const next = yield* Effect.gen(function* () {
        const events = yield* decideOrchestrationCommand({ command: first, readModel: snapshot });
        let model = snapshot;
        for (const [index, event] of (Array.isArray(events) ? events : [events]).entries()) {
          model = yield* projectEvent(model, { ...event, sequence: index + 1 });
        }
        return model;
      }).pipe(Effect.provide(NodeServices.layer));
      expect(next.projects[0]?.title).toBe("Upstream");
      expect(next.threads[0]?.messages[0]?.text).toBe("Existing question");
      const second = planImport({
        source,
        snapshot: next,
        history: [first.record],
        mappings,
        batchId: "second",
        now: at,
      });
      expect(second.commands).toEqual([]);
    }),
);
