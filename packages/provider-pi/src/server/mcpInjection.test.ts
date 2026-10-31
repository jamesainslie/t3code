import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@lathe/contracts";

import {
  LATHE_MCP_BEARER_ENV,
  LATHE_MCP_URL_ENV,
  LATHE_PI_RUNTIME_MODE_ENV,
  LATHE_PI_MCP_EXTENSION_PATH_ENV,
} from "./mcpExtensionSource.ts";
import { buildPiRpcLaunch, resolvePiLaunchArgs } from "./mcpInjection.ts";

const threadId = ThreadId.make("thread-pi-lathe-mcp");

const mcpSession = {
  environmentId: EnvironmentId.make("environment-pi-lathe-mcp"),
  threadId,
  providerSessionId: "mcp-session-pi",
  providerInstanceId: ProviderInstanceId.make("pi"),
  endpoint: "http://127.0.0.1:43123/mcp",
  authorizationHeader: "Bearer secret-pi-token",
  browserToolsAvailable: true,
};

describe("pi Lathe MCP injection", () => {
  it("always adds the permission bridge and configures MCP when available", () => {
    const resolvedArgs = resolvePiLaunchArgs(
      "--extension=/home/user/.pi/agent/extensions/demo.ts --session-dir=/tmp/pi-sessions --provider=anthropic --model=claude-sonnet --tools='' --name=-review --extension-flag=kept",
    );
    assert.isTrue(resolvedArgs.ok);
    if (!resolvedArgs.ok) return;
    const launch = buildPiRpcLaunch({
      launchArgs: resolvedArgs.args,
      environment: { PATH: "/usr/bin" },
      mcpSession,
      extensionPath: "/tmp/cache/pi-lathe-mcp-extension.ts",
      runtimeMode: "approval-required",
    });
    assert.deepEqual(launch.args, [
      "--mode",
      "rpc",
      "--extension",
      "/home/user/.pi/agent/extensions/demo.ts",
      "--session-dir",
      "/tmp/pi-sessions",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet",
      "--tools",
      "",
      "--name",
      "-review",
      "--extension-flag=kept",
      "--extension",
      "/tmp/cache/pi-lathe-mcp-extension.ts",
    ]);
    assert.notInclude(launch.args, "--no-extensions");
    assert.equal(launch.env[LATHE_MCP_URL_ENV], "http://127.0.0.1:43123/mcp");
    assert.equal(launch.env[LATHE_MCP_BEARER_ENV], "secret-pi-token");
    assert.equal(launch.env[LATHE_PI_RUNTIME_MODE_ENV], "approval-required");
    assert.equal(
      launch.env[LATHE_PI_MCP_EXTENSION_PATH_ENV],
      "/tmp/cache/pi-lathe-mcp-extension.ts",
    );

    const permissionOnly = buildPiRpcLaunch({
      launchArgs: [],
      environment: {
        [LATHE_MCP_URL_ENV]: "http://127.0.0.1:9999/stale",
        [LATHE_MCP_BEARER_ENV]: "stale-token",
        [LATHE_PI_MCP_EXTENSION_PATH_ENV]: "/stale/extension.ts",
      },
      mcpSession: undefined,
      extensionPath: "/tmp/cache/pi-lathe-mcp-extension.ts",
      runtimeMode: "auto-accept-edits",
    });
    assert.deepEqual(permissionOnly.args, [
      "--mode",
      "rpc",
      "--extension",
      "/tmp/cache/pi-lathe-mcp-extension.ts",
    ]);
    assert.isUndefined(permissionOnly.env[LATHE_MCP_URL_ENV]);
    assert.isUndefined(permissionOnly.env[LATHE_MCP_BEARER_ENV]);
    assert.equal(permissionOnly.env[LATHE_PI_RUNTIME_MODE_ENV], "auto-accept-edits");
    assert.equal(
      permissionOnly.env[LATHE_PI_MCP_EXTENSION_PATH_ENV],
      "/tmp/cache/pi-lathe-mcp-extension.ts",
    );
  });

  it("forces tools and user extensions off for unattended text generation", () => {
    const launch = buildPiRpcLaunch({
      launchArgs: [
        "--tools",
        "read,write",
        "--extension",
        "/home/user/.pi/agent/extensions/demo.ts",
        "--extension=./second.ts",
        "--provider",
        "anthropic",
      ],
      environment: {},
      mcpSession,
      extensionPath: "/tmp/cache/pi-lathe-mcp-extension.ts",
      sessionPath: "/fake/persisted.jsonl",
      ephemeral: true,
      disableExtensions: true,
      disableTools: true,
    });
    assert.deepEqual(launch.args, [
      "--mode",
      "rpc",
      "--no-session",
      "--provider",
      "anthropic",
      "--no-extensions",
      "--no-tools",
    ]);
    assert.deepInclude(resolvePiLaunchArgs("--mode text"), {
      ok: false,
      message: "Pi launch argument '--mode' is controlled by Lathe and cannot be overridden.",
    });
    assert.deepInclude(resolvePiLaunchArgs("--session old.jsonl"), { ok: false });
    assert.deepInclude(resolvePiLaunchArgs("prompt pi immediately"), { ok: false });
    assert.deepInclude(resolvePiLaunchArgs("--plan @instructions.md"), { ok: false });
  });

  it("rejects --provider without --model, which Pi 1.0 refuses at startup", () => {
    const rejection = {
      ok: false,
      message: "Pi launch argument '--provider' requires '--model'.",
    };
    assert.deepInclude(resolvePiLaunchArgs("--provider openrouter"), rejection);
    assert.deepInclude(resolvePiLaunchArgs("--provider=openrouter --models gpt-6"), rejection);
    assert.isTrue(resolvePiLaunchArgs("--provider openrouter --model=deepseek/v4").ok);
    assert.isTrue(resolvePiLaunchArgs("--model deepseek/v4").ok);
  });
});
