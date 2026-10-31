import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { summarizeMenuBar, type MenuBarEnvironment } from "./menuBarSummary.ts";

const now = "2026-10-31T12:00:00.000Z";
const at = (iso: string) => DateTime.makeUnsafe(iso);
const environmentId = EnvironmentId.make("env-local");
const projectId = ProjectId.make("project-1");
const provider = ProviderInstanceId.make("codex");

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "lathe",
  workspaceRoot: "/code/lathe",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function shell(id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId,
    title: `Thread ${id}`,
    providerInstanceId: provider,
    modelSelection: { instanceId: provider, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: at("2026-10-31T09:00:00.000Z"),
    updatedAt: at("2026-10-31T10:00:00.000Z"),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  } satisfies OrchestrationV2ThreadShell;
}

const approval: OrchestrationV2ThreadShell["pendingRuntimeRequest"] = {
  id: RuntimeRequestId.make("request-1"),
  kind: "command",
  createdAt: at("2026-10-31T11:00:00.000Z"),
};

const running = {
  latestRunId: RunId.make("run-1"),
  activeRunId: RunId.make("run-1"),
  status: "running",
  activityRunStatus: "running",
  activityRunStartedAt: at("2026-10-31T11:30:00.000Z"),
} satisfies Partial<OrchestrationV2ThreadShell>;

const completed = (completedAt: string, lastVisitedAt: string | null) =>
  ({
    latestRunId: RunId.make("run-done"),
    status: "completed",
    latestRunCompletedAt: at(completedAt),
    lastVisitedAt: lastVisitedAt === null ? null : at(lastVisitedAt),
  }) satisfies Partial<OrchestrationV2ThreadShell>;

function live(threads: ReadonlyArray<OrchestrationV2ThreadShell>): MenuBarEnvironment {
  return { environmentId, label: "This Mac", status: "live", projects: [project], threads };
}

const ids = (items: ReadonlyArray<{ readonly threadId: string }>) =>
  items.map((item) => item.threadId);

describe("summarizeMenuBar", () => {
  it("is idle with nothing running, waiting or unread", () => {
    const summary = summarizeMenuBar([live([shell("quiet")])], now);
    expect(summary).toMatchObject({ icon: "idle", needsYou: [], running: [], finished: [] });
  });

  it("puts approvals in Needs you and lets attention outrank working", () => {
    const summary = summarizeMenuBar(
      [live([shell("busy", running), shell("asks", { pendingRuntimeRequest: approval })])],
      now,
    );
    expect(summary.icon).toBe("attention");
    expect(summary.needsYou).toEqual([
      {
        environmentId,
        environmentLabel: "This Mac",
        threadId: "asks",
        title: "Thread asks",
        projectTitle: "lathe",
        kind: "approval",
        since: "2026-10-31T11:00:00.000Z",
      },
    ]);
    expect(ids(summary.running)).toEqual(["busy"]);
    expect(summary.running[0]).toMatchObject({
      kind: "working",
      since: "2026-10-31T11:30:00.000Z",
    });
  });

  it("is working when a turn runs and nothing waits on the user", () => {
    expect(summarizeMenuBar([live([shell("busy", running)])], now).icon).toBe("working");
  });

  it("lifts a live subagent's approval onto its listed parent", () => {
    const parent = shell("parent", running);
    const child = shell("child", {
      ...running,
      pendingRuntimeRequest: approval,
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent",
      },
    });
    const summary = summarizeMenuBar([live([parent, child])], now);
    expect(ids(summary.needsYou)).toEqual(["parent"]);
    expect(ids(summary.running)).toEqual([]);
  });

  it("hides snoozed, archived and deleted threads unless a snoozed one asks for the user", () => {
    const snoozed = { snoozedUntil: at("2026-11-01T00:00:00.000Z") };
    const summary = summarizeMenuBar(
      [
        live([
          shell("snoozed", { ...running, ...snoozed }),
          shell("archived", { ...running, archivedAt: at("2026-10-31T11:00:00.000Z") }),
          shell("deleted", { ...running, deletedAt: at("2026-10-31T11:00:00.000Z") }),
          shell("woke", { ...snoozed, pendingRuntimeRequest: approval }),
        ]),
      ],
      now,
    );
    expect(ids(summary.needsYou)).toEqual(["woke"]);
    expect(ids(summary.running)).toEqual([]);
  });

  it("lists completions finished after the last visit, newest first, as the sidebar does", () => {
    const summary = summarizeMenuBar(
      [
        live([
          shell("older", completed("2026-10-31T10:00:00.000Z", "2026-10-31T09:00:00.000Z")),
          shell("newer", completed("2026-10-31T11:00:00.000Z", "2026-10-31T09:00:00.000Z")),
          shell("seen", completed("2026-10-31T10:00:00.000Z", "2026-10-31T10:30:00.000Z")),
          shell("never-opened", completed("2026-10-31T10:00:00.000Z", null)),
          shell("broke", {
            ...completed("2026-10-31T10:30:00.000Z", null),
            status: "failed",
          }),
        ]),
      ],
      now,
    );
    expect(summary.icon).toBe("idle");
    expect(ids(summary.finished)).toEqual(["newer", "broke", "older"]);
    expect(summary.finished[1]).toMatchObject({ kind: "failed" });
    expect(summary.finished[0]).toMatchObject({ kind: "done", since: "2026-10-31T11:00:00.000Z" });
  });

  it("reports environments it cannot read, across several environments", () => {
    const remote = EnvironmentId.make("env-remote");
    const summary = summarizeMenuBar(
      [
        live([shell("local", running)]),
        {
          environmentId: remote,
          label: "incus-work",
          status: "live",
          projects: [project],
          threads: [shell("remote", { pendingRuntimeRequest: approval })],
        },
        {
          environmentId: EnvironmentId.make("env-relay"),
          label: "Office",
          status: "unavailable",
          reason: "Relay environments are not supported in the menu bar yet.",
        },
        {
          environmentId: EnvironmentId.make("env-wait"),
          label: "hephaestus",
          status: "connecting",
        },
      ],
      now,
    );
    expect(summary.needsYou[0]).toMatchObject({
      environmentId: remote,
      environmentLabel: "incus-work",
    });
    expect(summary.unavailable).toEqual([
      {
        environmentId: "env-relay",
        label: "Office",
        reason: "Relay environments are not supported in the menu bar yet.",
      },
    ]);
  });
});
