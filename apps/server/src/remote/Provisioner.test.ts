import { describe, expect, it } from "vitest";
import { parseServerStateFile, buildStartServerCommand } from "./Provisioner.ts";

describe("parseServerStateFile", () => {
  it("parses valid state file JSON", () => {
    const json = JSON.stringify({ port: 38100, pid: 12345, startedAt: "2026-01-01T00:00:00Z" });
    expect(parseServerStateFile(json)).toEqual({ port: 38100, pid: 12345 });
  });

  it("returns null for invalid JSON", () => {
    expect(parseServerStateFile("not json")).toBeNull();
  });

  it("returns null when port is missing", () => {
    expect(parseServerStateFile(JSON.stringify({ pid: 123 }))).toBeNull();
  });

  it("returns null when pid is missing", () => {
    expect(parseServerStateFile(JSON.stringify({ port: 1234 }))).toBeNull();
  });
});

describe("buildStartServerCommand", () => {
  it("includes projectId in tmux session name", () => {
    const cmd = buildStartServerCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("t3-proj-abc");
  });

  it("includes workspaceRoot in the server start command", () => {
    const cmd = buildStartServerCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("/home/james/myapp");
  });

  it("includes --auth-token-file flag", () => {
    const cmd = buildStartServerCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("--auth-token-file");
  });

  it("includes --state-file flag", () => {
    const cmd = buildStartServerCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("--state-file");
  });
});
