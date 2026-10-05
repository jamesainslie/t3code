import {
  ComposerContextId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { collectComposerContextReferences } from "./composerContextReferences.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";
import {
  buildContinuePrompt,
  buildThreadChipClipboard,
  canContinueThread,
  buildThreadContextRecord,
  threadContextId,
  threadContextMarkdown,
} from "./threadContextReference.ts";

const isComposerContextId = Schema.is(ComposerContextId);

const thread = {
  environmentId: EnvironmentId.make("env-1"),
  id: ThreadId.make("0B7E6F7A-3C1D-4E5F-9A8B-1C2D3E4F5A6B"),
  title: "Fix [login]\r\nredirect",
};
const projectId = ProjectId.make("project-1");

describe("threadContextReference", () => {
  it("builds a thread chip whose text references its record", () => {
    const result = buildThreadChipClipboard({ thread });

    expect(result.fragment.source.environmentId).toBe("env-1");
    expect(result.fragment.records).toHaveLength(1);
    const record = result.fragment.records[0]!;
    const occurrences = collectComposerContextReferences(result.text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      kind: "thread",
      contextId: record.contextId,
      label: "Fix login redirect",
    });
    expect(record).toMatchObject({
      kind: "thread",
      label: "Fix login redirect",
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: "Fix [login] redirect",
    });
  });

  it("keeps a multi-line title on one line in the record and its link", () => {
    const record = buildThreadContextRecord(thread);
    expect(record.title).toBe("Fix [login] redirect");
    expect(threadContextMarkdown(record)).toBe(
      "[Fix login redirect](t3-context://v1/thread/thread-0b7e6f7a-3c1d-4e5f-9a8b-1c2d3e4f5a6b)",
    );
  });

  it("caps a long title without splitting a surrogate pair", () => {
    const title = `${"a".repeat(2_047)}\u{1F600}tail`;
    const record = buildThreadContextRecord({ ...thread, title });
    expect(record.title).toBe("a".repeat(2_047));
    expect(record.title.isWellFormed()).toBe(true);
  });

  it("threadContextId is stable for a thread", () => {
    expect(threadContextId(thread.id)).toBe("thread-0b7e6f7a-3c1d-4e5f-9a8b-1c2d3e4f5a6b");
    expect(threadContextId(thread.id)).toBe(threadContextId(ThreadId.make(thread.id)));
  });

  it("threadContextId folds imported thread ids into a valid, stable id", () => {
    const imported = ThreadId.make("import:claudeAgent:0B7E6F7A-3C1D-4E5F-9A8B-1C2D3E4F5A6B");
    const id = threadContextId(imported);

    expect(id).toMatch(/^thread-import-claudeagent-[a-z0-9-]*-[0-9a-f]{16}$/);
    expect(isComposerContextId(id)).toBe(true);
    expect(threadContextId(ThreadId.make(imported))).toBe(id);
    expect(threadContextId(ThreadId.make("import:codex:0B7E6F7A"))).not.toBe(id);
  });

  it("threadContextId keeps very long thread ids within the id bound", () => {
    const first = threadContextId(ThreadId.make(`${"a".repeat(200)}1`));
    const second = threadContextId(ThreadId.make(`${"a".repeat(200)}2`));

    expect(first.length).toBeLessThanOrEqual(128);
    expect(isComposerContextId(first)).toBe(true);
    expect(first).not.toBe(second);
  });

  const continuationServer = (settings: typeof DEFAULT_SERVER_SETTINGS) => ({
    settings,
    environment: { capabilities: { threadContinuation: true } },
  });

  it("canContinueThread follows the resolved project level", () => {
    const otherProjectId = ProjectId.make("project-2");
    const offByDefault = continuationServer(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        agentThreadHistoryAccess: "off",
        projectSettingsOverrides: { [projectId]: { agentThreadHistoryAccess: "project" } },
      }),
    );
    expect(canContinueThread(offByDefault, projectId)).toBe(true);
    expect(canContinueThread(offByDefault, otherProjectId)).toBe(false);

    const onByDefault = continuationServer(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        agentThreadHistoryAccess: "referenced",
        projectSettingsOverrides: { [projectId]: { agentThreadHistoryAccess: "off" } },
      }),
    );
    expect(canContinueThread(onByDefault, projectId)).toBe(false);
    expect(canContinueThread(onByDefault, otherProjectId)).toBe(true);
  });

  it("canContinueThread is false for servers that do not advertise continuation", () => {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      agentThreadHistoryAccess: "project",
    });
    expect(canContinueThread({ settings, environment: { capabilities: {} } }, projectId)).toBe(
      false,
    );
    expect(
      canContinueThread(
        { settings, environment: { capabilities: { threadContinuation: false } } },
        projectId,
      ),
    ).toBe(false);
    expect(canContinueThread(undefined, projectId)).toBe(false);
  });

  it("buildContinuePrompt references the source thread", () => {
    const record = buildThreadContextRecord(thread);
    const prompt = buildContinuePrompt(record);

    expect(prompt).toBe(`Continue the work from ${threadContextMarkdown(record)}.`);
    const occurrences = collectComposerContextReferences(prompt);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ kind: "thread", contextId: record.contextId });
  });
});
