import { describe, expect, it } from "vitest";

import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("WS_METHODS", () => {
  it("exposes projectsReadFile", () => {
    expect(WS_METHODS.projectsReadFile).toBe("projects.readFile");
  });

  it("exposes subscribeProjectFileChanges", () => {
    expect(WS_METHODS.subscribeProjectFileChanges).toBe(
      "subscribeProjectFileChanges",
    );
  });

  it("exposes projectsUpdateFrontmatter", () => {
    expect(WS_METHODS.projectsUpdateFrontmatter).toBe(
      "projects.updateFrontmatter",
    );
  });
});

describe("WsRpcGroup", () => {
  it("registers docs browser RPC handlers", () => {
    const requests = WsRpcGroup.requests;
    // Requests is a Map keyed by method tag (the underlying WS_METHOD string)
    expect(requests.has(WS_METHODS.projectsReadFile)).toBe(true);
    expect(requests.has(WS_METHODS.subscribeProjectFileChanges)).toBe(true);
    expect(requests.has(WS_METHODS.projectsUpdateFrontmatter)).toBe(true);
  });
});
