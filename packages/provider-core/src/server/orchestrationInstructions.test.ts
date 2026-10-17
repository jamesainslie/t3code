import { assert, describe, it } from "@effect/vitest";

import {
  LATHE_ORCHESTRATION_INSTRUCTIONS,
  latheAcpPromptWithInstructions,
  latheOrchestrationPromptForFirstRun,
  latheOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("Lathe orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "ordinary top-level Lathe conversations");
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      LATHE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `lathe_thread_send` on `childThreadId`",
    );
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(LATHE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = latheOrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasLatheMcp: true,
    });

    assert.include(injected, "<lathe_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      latheOrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasLatheMcp: true }),
      prompt,
    );
    assert.equal(
      latheOrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasLatheMcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the Lathe MCP server is attached", () => {
    assert.equal(latheOrchestrationSystemPrompt(false), undefined);
    assert.equal(latheOrchestrationSystemPrompt(true), LATHE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = latheAcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasLatheMcp: true },
    });

    assert.include(injected, "Lathe interaction mode: Default");
    assert.include(injected, "Lathe collaborative browser");
    assert.include(injected, "Lathe orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasLatheMcp: true } as const;

    assert.equal(
      latheAcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      latheAcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "Lathe interaction mode: Plan",
    );
    const withoutMcp = latheAcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasLatheMcp: false },
    });
    assert.include(withoutMcp, "Lathe interaction mode: Default");
    assert.notInclude(withoutMcp, "Lathe collaborative browser");
    assert.notInclude(withoutMcp, "Lathe orchestration");
  });
});
