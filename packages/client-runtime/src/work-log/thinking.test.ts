import {
  EnvironmentId,
  NodeId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { v2Now, v2Projection } from "../state/orchestrationV2TestFixtures.ts";
import { createEnvironmentThreadDetailAtoms } from "../state/threadDetail.ts";
import { EMPTY_THREAD_HISTORY_META } from "../state/threadHistoryMerge.ts";
import { derivePendingThreadRequests } from "../state/threadRequests.ts";
import { questionLeadIn, thinkingSplitsWorkGroup } from "./thinking.ts";

const runId = RunId.make("run-1");
const providerTurnId = ProviderTurnId.make("provider-turn-1");
const requestId = RuntimeRequestId.make("question-1");

function base(id: string, ordinal: number, turn = providerTurnId) {
  return {
    id: TurnItemId.make(id),
    threadId: v2Projection.thread.id,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: turn,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: v2Now,
    completedAt: v2Now,
    updatedAt: v2Now,
  };
}

const thought = (id: string, ordinal: number, text: string, turn = providerTurnId) =>
  ({ ...base(id, ordinal, turn), type: "reasoning", text, streaming: false }) as const;

const askTool = {
  ...base("ask-tool", 4),
  status: "running",
  type: "dynamic_tool",
  toolName: "AskUserQuestion",
  input: {},
} as unknown as OrchestrationV2TurnItem;

const finishedTool = {
  ...base("read-tool", 1),
  type: "dynamic_tool",
  toolName: "Read",
  input: {},
} as unknown as OrchestrationV2TurnItem;

const question: OrchestrationV2TurnItem = {
  ...base("question", 5),
  nodeId: NodeId.make("question-node"),
  status: "waiting",
  type: "user_input_request",
  requestId,
  questions: [
    {
      id: "pick",
      header: "Pick",
      question: "Which approach?",
      required: true,
      allowCustomAnswer: true,
      options: [{ label: "A", value: "a", description: "Option A" }],
    },
  ],
};

describe("questionLeadIn", () => {
  it("joins the thoughts right before the question, skipping the call that raised it", () => {
    // Arrival order differs from ordinal order on the client.
    const items = [
      question,
      thought("t3", 3, "Option B is safer."),
      askTool,
      finishedTool,
      thought("t2", 2, "  Option A is faster.  "),
      thought("t0", 0, "Earlier plan."),
    ];
    expect(questionLeadIn(items, question)).toBe("Option A is faster.\n\nOption B is safer.");
  });

  it("ignores other provider turns and questions without preceding thoughts", () => {
    const otherTurn = ProviderTurnId.make("provider-turn-0");
    expect(questionLeadIn([thought("old", 3, "Old turn.", otherTurn), question], question)).toBe(
      undefined,
    );
    expect(questionLeadIn([finishedTool, askTool, question], question)).toBe(undefined);
  });

  it("travels with the pending question", () => {
    const projection: OrchestrationV2ThreadProjection = {
      ...v2Projection,
      runtimeRequests: [
        {
          id: requestId,
          nodeId: NodeId.make("question-node"),
          providerTurnId,
          nativeRequestRef: null,
          kind: "user_input",
          status: "pending",
          responseCapability: { type: "message" },
          createdAt: v2Now,
          resolvedAt: null,
        },
      ],
      turnItems: [thought("t3", 3, "Why I am asking."), askTool, question],
    };
    expect(derivePendingThreadRequests(projection).userInputs).toMatchObject([
      { requestId, leadIn: "Why I am asking." },
    ]);
    // Mobile reads pending questions through the thread detail atom, which
    // narrows the projection before deriving them.
    const source = Atom.make(
      AsyncResult.success({
        data: Option.some(projection),
        status: "live" as const,
        error: Option.none(),
        history: EMPTY_THREAD_HISTORY_META,
      }),
    );
    const details = createEnvironmentThreadDetailAtoms(() => source);
    const registry = AtomRegistry.make();
    const ref = { environmentId: EnvironmentId.make("env"), threadId: projection.thread.id };
    const dispose = registry.mount(details.pendingRequestsAtom(ref));
    expect(registry.get(details.pendingRequestsAtom(ref))?.userInputs).toMatchObject([
      { requestId, leadIn: "Why I am asking." },
    ]);
    dispose();
    registry.dispose();
  });
});

describe("thinkingSplitsWorkGroup", () => {
  it("keeps a thought out of any group", () => {
    expect(thinkingSplitsWorkGroup("reasoning", "command_execution")).toBe(true);
    expect(thinkingSplitsWorkGroup("dynamic_tool", "reasoning")).toBe(true);
    expect(thinkingSplitsWorkGroup("reasoning", "reasoning")).toBe(true);
    expect(thinkingSplitsWorkGroup("command_execution", "file_change")).toBe(false);
  });
});
