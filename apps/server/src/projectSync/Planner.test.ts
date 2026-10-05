import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProjectSyncProjectSnapshot,
  type ProjectSyncRecord,
} from "@t3tools/contracts";
import { planImport, planUndo, syncedThreadKey } from "./Planner.ts";
import type { SyncSource, SyncThread } from "./Source.ts";

const at = "2026-09-07T00:00:00Z";
const project: ProjectSyncProjectSnapshot = {
  id: ProjectId.make("upstream-project"),
  title: "Upstream",
  workspaceRoot: "/example",
  defaultModelSelection: null,
  scripts: [],
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
};
const sourceOf = (projects: SyncSource["projects"], contentHash = "content"): SyncSource => ({
  version: 2,
  sourceHome: "/source",
  sourceId: "source-id",
  contentHash,
  projects,
});
const record = (overrides: Partial<ProjectSyncRecord>): ProjectSyncRecord => ({
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
  projectChanges: [],
  ...overrides,
});
const conversation: SyncThread = {
  id: ThreadId.make("upstream-thread"),
  title: "A conversation",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  createdAt: at,
  updatedAt: at,
  messages: [
    {
      id: "upstream-message",
      role: "user",
      text: "Existing question",
      attachments: [],
      createdAt: at,
    },
  ],
  activities: [],
};

it("preserves settings on a matched fork project", () => {
  const local = { ...project, id: ProjectId.make("local-project"), title: "My fork title" };
  const plan = planImport({
    source: sourceOf([{ project, threads: [], warnings: [] }]),
    projects: [local],
    threads: [],
    history: [],
    mappings: [{ sourceProjectId: project.id, projectId: local.id }],
    batchId: "batch-1",
    now: at,
  });
  expect(plan.record.mappings[0]?.projectId).toBe(local.id);
  expect(plan.steps).toEqual([]);
  expect(plan.record.projectChanges).toEqual([]);
});

it("allows an explicit separate imported project at an existing workspace", () => {
  const plan = planImport({
    source: sourceOf([{ project, threads: [], warnings: [] }]),
    projects: [{ ...project, id: ProjectId.make("local") }],
    threads: [],
    history: [],
    mappings: [{ sourceProjectId: project.id, projectId: ProjectId.make("separate") }],
    batchId: "separate",
    now: at,
  });
  expect(plan.steps).toMatchObject([{ type: "project.create", projectId: "separate" }]);
});

it("keeps a local title override across successive upstream setting updates", () => {
  const local = { ...project, title: "My title", autoPull: false };
  const history = [
    record({
      projectChanges: [
        {
          before: null,
          after: { ...project, autoPull: false },
          ownedSettings: ["title", "autoPull"],
        },
      ],
    }),
  ];
  const source = sourceOf(
    [
      {
        project: { ...project, title: "Upstream renamed", autoPull: true },
        threads: [],
        warnings: [],
      },
    ],
    "new",
  );
  const mappings = [{ sourceProjectId: project.id, projectId: project.id }];
  const first = planImport({
    source,
    projects: [local],
    threads: [],
    history,
    mappings,
    batchId: "second",
    now: at,
  });
  const after = first.record.projectChanges[0]!.after;
  expect(after.title).toBe("My title");
  expect(after.autoPull).toBe(true);
  const second = planImport({
    source: sourceOf([
      {
        project: { ...project, title: "Another rename", autoPull: false },
        threads: [],
        warnings: [],
      },
    ]),
    projects: [after],
    threads: [],
    history: [first.record, ...history],
    mappings,
    batchId: "third",
    now: at,
  });
  expect(second.record.projectChanges[0]!.after.title).toBe("My title");
});

it("preserves an explicit local setting even when its value still matches the last import", () => {
  const plan = planImport({
    source: sourceOf(
      [{ project: { ...project, title: "Renamed" }, threads: [], warnings: [] }],
      "new",
    ),
    projects: [project],
    threads: [],
    history: [record({ projectChanges: [{ before: null, after: project }] })],
    mappings: [{ sourceProjectId: project.id, projectId: project.id }],
    localSettingOverrides: new Map([[project.id, new Set(["title"])]]),
    batchId: "second",
    now: at,
  });
  expect(plan.steps).toEqual([]);
});

it("imports a new project and history archived, then plans no duplicate work", () => {
  const source = sourceOf([{ project, threads: [conversation], warnings: [] }]);
  const projectId = ProjectId.make("new-project");
  const mappings = [{ sourceProjectId: project.id, projectId }];
  const first = planImport({
    source,
    projects: [],
    threads: [],
    history: [],
    mappings,
    batchId: "first",
    now: at,
  });
  expect(first.steps.map((step) => step.type)).toEqual([
    "project.create",
    "thread.import",
    "thread.archive",
  ]);
  const threadId = first.record.visibleThreadIds[0]!;
  expect(threadId.startsWith("t3sync-")).toBe(true);
  const second = planImport({
    source,
    projects: [{ ...project, id: projectId }],
    threads: [{ id: threadId, projectId, deletedAt: null, archivedAt: at, settledOverride: null }],
    history: [first.record],
    mappings,
    batchId: "second",
    now: at,
  });
  expect(second.steps).toEqual([]);
});

it("replaces a changed conversation and carries the user's organization to the new version", () => {
  const projectId = ProjectId.make("new-project");
  const mappings = [{ sourceProjectId: project.id, projectId }];
  const first = planImport({
    source: sourceOf([{ project, threads: [conversation], warnings: [] }]),
    projects: [],
    threads: [],
    history: [],
    mappings,
    batchId: "first",
    now: at,
  });
  const oldId = first.record.visibleThreadIds[0]!;
  const next = planImport({
    source: sourceOf([{ project, threads: [{ ...conversation, title: "Renamed" }], warnings: [] }]),
    projects: [{ ...project, id: projectId }],
    threads: [
      { id: oldId, projectId, deletedAt: null, archivedAt: null, settledOverride: "active" },
    ],
    history: [first.record],
    mappings,
    batchId: "second",
    now: at,
    localThreadManagement: new Map([
      [syncedThreadKey(oldId), { archived: false, settledOverride: "active" as const }],
    ]),
  });
  const newId = next.record.visibleThreadIds[0]!;
  expect(syncedThreadKey(newId)).toBe(syncedThreadKey(oldId));
  expect(next.record.hiddenThreadIds).toEqual([oldId]);
  expect(next.steps.map((step) => step.type)).toEqual([
    "thread.visibility",
    "thread.import",
    "thread.unsettle",
  ]);
});

it("undoes a batch: hides its versions, restores what it hid, drops an untouched new project", () => {
  const created = ProjectId.make("created");
  const visible = ThreadId.make("t3sync-a-b-new");
  const hidden = ThreadId.make("t3sync-a-c-old");
  const plan = planUndo({
    active: record({
      id: "batch",
      visibleThreadIds: [visible],
      hiddenThreadIds: [hidden],
      projectChanges: [{ before: null, after: { ...project, id: created } }],
    }),
    projects: [{ ...project, id: created }],
    threads: [
      { id: hidden, projectId: created, deletedAt: at, archivedAt: at, settledOverride: null },
    ],
    localThreadProjects: new Set(),
    localSettingOverrides: new Map(),
    localThreadManagement: new Map(),
    batchId: "undo",
    now: at,
    schedule: { enabled: false, hour: 3, timezone: "UTC" },
  });
  expect(plan.steps).toEqual([
    { type: "thread.visibility", threadId: visible, visible: false },
    { type: "thread.visibility", threadId: hidden, visible: true },
    { type: "project.delete", projectId: created },
  ]);
  expect(plan.record).toMatchObject({
    undoBatchId: "batch",
    visibleThreadIds: [hidden],
    hiddenThreadIds: [visible],
  });
});

it("keeps a new project on undo once the user has made it their own", () => {
  const created = ProjectId.make("created");
  const plan = planUndo({
    active: record({ projectChanges: [{ before: null, after: { ...project, id: created } }] }),
    projects: [{ ...project, id: created }],
    threads: [],
    localThreadProjects: new Set([created]),
    localSettingOverrides: new Map(),
    localThreadManagement: new Map(),
    batchId: "undo",
    now: at,
    schedule: { enabled: false, hour: 3, timezone: "UTC" },
  });
  expect(plan.steps).toEqual([]);
});
