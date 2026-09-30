import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { collectComposerContextReferences } from "./composerContextReferences.ts";
import {
  buildThreadChipClipboard,
  buildThreadContextRecord,
  threadContextId,
  threadContextMarkdown,
} from "./threadContextReference.ts";

const thread = {
  id: ThreadId.make("0B7E6F7A-3C1D-4E5F-9A8B-1C2D3E4F5A6B"),
  projectId: ProjectId.make("project-1"),
  title: "Fix [login]\r\nredirect",
};

describe("threadContextReference", () => {
  it("builds a thread chip whose text references its record", () => {
    const result = buildThreadChipClipboard({
      environmentId: EnvironmentId.make("env-1"),
      thread,
    });

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
      threadId: thread.id,
      projectId: thread.projectId,
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

  it("threadContextId is stable for a thread", () => {
    expect(threadContextId(thread.id)).toBe("thread-0b7e6f7a-3c1d-4e5f-9a8b-1c2d3e4f5a6b");
    expect(threadContextId(thread.id)).toBe(threadContextId(ThreadId.make(thread.id)));
  });
});
