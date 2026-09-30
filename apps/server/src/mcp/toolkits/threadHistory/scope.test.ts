import {
  ComposerContextId,
  MessageId,
  ProjectId,
  ThreadId,
  type AgentThreadHistoryAccess,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { canReadThread, canSearchThreads, collectReferencedThreadIds } from "./scope.ts";

const CALLER_THREAD_ID = ThreadId.make("thread-caller");
const CALLER_PROJECT_ID = ProjectId.make("project-caller");
const SIBLING_THREAD_ID = ThreadId.make("thread-sibling");
const OTHER_THREAD_ID = ThreadId.make("thread-other");
const REFERENCED_THREAD_ID = ThreadId.make("thread-referenced");
const OTHER_PROJECT_ID = ProjectId.make("project-other");
const EARLIER_THREAD_ID = ThreadId.make("thread-earlier");
const PAYLOAD_THREAD_ID = ThreadId.make("thread-in-payload");
const TEXT_THREAD_ID = ThreadId.make("thread-in-text");

type Relation = "self" | "sameProject" | "otherProject" | "referencedOtherProject";

const targets = {
  self: { targetThreadId: CALLER_THREAD_ID, targetProjectId: CALLER_PROJECT_ID },
  sameProject: { targetThreadId: SIBLING_THREAD_ID, targetProjectId: CALLER_PROJECT_ID },
  otherProject: { targetThreadId: OTHER_THREAD_ID, targetProjectId: OTHER_PROJECT_ID },
  referencedOtherProject: {
    targetThreadId: REFERENCED_THREAD_ID,
    targetProjectId: OTHER_PROJECT_ID,
  },
} satisfies Record<Relation, unknown>;

const rows: ReadonlyArray<readonly [AgentThreadHistoryAccess, Relation, boolean]> = [
  ["off", "self", false],
  ["off", "sameProject", false],
  ["off", "otherProject", false],
  ["off", "referencedOtherProject", false],
  ["referenced", "self", true],
  ["referenced", "sameProject", false],
  ["referenced", "otherProject", false],
  ["referenced", "referencedOtherProject", true],
  ["project", "self", true],
  ["project", "sameProject", true],
  ["project", "otherProject", false],
  ["project", "referencedOtherProject", true],
  ["environment", "self", true],
  ["environment", "sameProject", true],
  ["environment", "otherProject", true],
  ["environment", "referencedOtherProject", true],
];

function userMessage(
  id: string,
  context?: OrchestrationMessage["context"],
  text = "hello",
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role: "user",
    text,
    ...(context ? { context } : {}),
    turnId: null,
    streaming: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("thread history scope", () => {
  it("canReadThread follows the access level", () => {
    for (const [level, relation, expected] of rows) {
      const actual = canReadThread({
        callerThreadId: CALLER_THREAD_ID,
        callerProjectId: CALLER_PROJECT_ID,
        ...targets[relation],
        level,
        referencedThreadIds: new Set([REFERENCED_THREAD_ID]),
      });
      expect({ level, relation, allowed: actual }).toEqual({ level, relation, allowed: expected });
    }
  });

  it("canSearchThreads only at project and environment", () => {
    expect(canSearchThreads("off")).toBe(false);
    expect(canSearchThreads("referenced")).toBe(false);
    expect(canSearchThreads("project")).toBe(true);
    expect(canSearchThreads("environment")).toBe(true);
  });

  it("collects thread ids from thread records in any message", () => {
    const referenced = collectReferencedThreadIds({
      messages: [
        userMessage("message-1", {
          version: 1,
          records: [
            {
              version: 1,
              contextId: ComposerContextId.make("context-earlier"),
              label: "Earliest work",
              kind: "thread",
              threadId: EARLIER_THREAD_ID,
              projectId: CALLER_PROJECT_ID,
              title: "Earliest work",
            },
          ],
        }),
        userMessage(
          "message-2",
          {
            version: 1,
            records: [
              {
                version: 1,
                contextId: ComposerContextId.make("context-thread"),
                label: "Earlier work",
                kind: "thread",
                threadId: REFERENCED_THREAD_ID,
                projectId: OTHER_PROJECT_ID,
                title: "Earlier work",
              },
              {
                version: 1,
                contextId: ComposerContextId.make("context-mention"),
                label: "README.md",
                kind: "mention",
                path: "README.md",
              },
              // A kind this build does not know, whose payload happens to name a thread.
              {
                version: 1,
                contextId: ComposerContextId.make("context-future"),
                label: "Future kind",
                kind: "future-thread",
                payload: { kind: "thread", threadId: PAYLOAD_THREAD_ID },
              },
            ],
          },
          // Thread ids in message text, linked or raw, are not references.
          `See [Other](t3-context://v1/thread/${TEXT_THREAD_ID}) and ${TEXT_THREAD_ID}`,
        ),
      ],
    });

    expect([...referenced].toSorted()).toEqual(
      [EARLIER_THREAD_ID, REFERENCED_THREAD_ID].toSorted(),
    );
  });

  it("a continued thread may read its source at the referenced level", () => {
    const readsSource = (caller: Parameters<typeof collectReferencedThreadIds>[0]) =>
      canReadThread({
        callerThreadId: CALLER_THREAD_ID,
        callerProjectId: CALLER_PROJECT_ID,
        targetThreadId: OTHER_THREAD_ID,
        targetProjectId: OTHER_PROJECT_ID,
        level: "referenced",
        referencedThreadIds: collectReferencedThreadIds(caller),
      });

    expect(readsSource({ messages: [], continuedFromThreadId: OTHER_THREAD_ID })).toBe(true);
    expect(readsSource({ messages: [], continuedFromThreadId: null })).toBe(false);
    expect(readsSource({ messages: [] })).toBe(false);
  });
});
