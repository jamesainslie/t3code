import { assert, describe, it } from "@effect/vitest";

import { claudeToolRequestWithoutTurn } from "./ForkClaudeToolRequestWithoutTurn.ts";

describe("claudeToolRequestWithoutTurn", () => {
  it("denies a Bash call and steers the agent away from retrying it unchanged", () => {
    const result = claudeToolRequestWithoutTurn("Bash", "toolu_1");

    assert.strictEqual(result.behavior, "deny");
    assert.strictEqual(result.toolUseID, "toolu_1");
    if (result.behavior !== "deny") return;
    assert.include(result.message, "cannot reach the user");
    assert.include(result.message, "Do not retry the same call");
    assert.include(result.message, "bash -c");
    assert.include(result.message, "Edit or Write tools");
  });

  it("tells an agent asking a question to decide and report instead", () => {
    const result = claudeToolRequestWithoutTurn("AskUserQuestion", "toolu_2");

    assert.strictEqual(result.behavior, "deny");
    assert.strictEqual(result.toolUseID, "toolu_2");
    if (result.behavior !== "deny") return;
    assert.include(result.message, "cannot reach the user");
    assert.include(result.message, "final report");
    assert.notInclude(result.message, "bash -c");
  });

  it("gives other tools the general guidance without the shell advice", () => {
    const result = claudeToolRequestWithoutTurn("Write", "toolu_3");

    assert.strictEqual(result.behavior, "deny");
    if (result.behavior !== "deny") return;
    assert.include(result.message, "Do not retry the same call");
    assert.notInclude(result.message, "bash -c");
  });

  it("lets the agent carry on rather than interrupting it", () => {
    for (const tool of ["Bash", "AskUserQuestion", "Write"]) {
      const result = claudeToolRequestWithoutTurn(tool, "toolu_4");
      assert.isFalse("interrupt" in result && result.interrupt === true);
    }
  });
});
