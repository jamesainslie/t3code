import { describe, expect, it } from "vitest";
import {
  buildCheckSocketArgs,
  buildPortForwardArgs,
  buildSshArgs,
  buildTmuxCheckCommand,
  buildTmuxKillCommand,
  buildTmuxStartCommand,
  controlSocketPath,
  parseProbeOutput,
  parseTmuxSessionList,
  remoteAuthTokenFile,
  remoteEnvFile,
  remoteServerStateFile,
  resolveRemotePlatform,
  tmuxSessionName,
} from "./ssh.ts";

describe("parseProbeOutput", () => {
  it("parses valid probe output", () => {
    const result = parseProbeOutput("OS:Linux ARCH:aarch64 VERSION:0.0.15");
    expect(result).toEqual({ os: "Linux", arch: "aarch64", currentVersion: "0.0.15" });
  });

  it("parses empty version as empty string", () => {
    const result = parseProbeOutput("OS:Darwin ARCH:x86_64 VERSION:");
    expect(result).toEqual({ os: "Darwin", arch: "x86_64", currentVersion: "" });
  });

  it("returns null for invalid output", () => {
    expect(parseProbeOutput("garbage")).toBeNull();
    expect(parseProbeOutput("")).toBeNull();
  });
});

describe("resolveRemotePlatform", () => {
  it("resolves Linux aarch64 to linux/arm64", () => {
    expect(resolveRemotePlatform("Linux", "aarch64")).toEqual({ platform: "linux", arch: "arm64" });
  });

  it("resolves Linux x86_64 to linux/x64", () => {
    expect(resolveRemotePlatform("Linux", "x86_64")).toEqual({ platform: "linux", arch: "x64" });
  });

  it("resolves Darwin arm64 to darwin/arm64", () => {
    expect(resolveRemotePlatform("Darwin", "arm64")).toEqual({ platform: "darwin", arch: "arm64" });
  });

  it("returns null for unsupported platform", () => {
    expect(resolveRemotePlatform("Windows", "x86_64")).toBeNull();
    expect(resolveRemotePlatform("Linux", "s390x")).toBeNull();
  });
});

describe("buildSshArgs", () => {
  it("includes ControlMaster=auto", () => {
    const args = buildSshArgs({ host: "devbox", user: "james", port: 22 });
    const joined = args.join(" ");
    expect(joined).toContain("ControlMaster=auto");
    expect(joined).toContain("james@devbox");
  });

  it("includes -p for non-standard port", () => {
    const args = buildSshArgs({ host: "devbox", user: "james", port: 2222 });
    expect(args).toContain("-p");
    expect(args).toContain("2222");
  });

  it("omits -p for port 22", () => {
    const args = buildSshArgs({ host: "devbox", user: "james", port: 22 });
    expect(args).not.toContain("-p");
  });
});

describe("buildCheckSocketArgs", () => {
  it("includes -O check", () => {
    const args = buildCheckSocketArgs({ host: "devbox", user: "james", port: 22 });
    expect(args).toContain("-O");
    expect(args).toContain("check");
  });
});

describe("buildPortForwardArgs", () => {
  it("includes -L with correct spec", () => {
    const args = buildPortForwardArgs({
      host: "devbox",
      user: "james",
      port: 22,
      localPort: 49200,
      remotePort: 38100,
    });
    expect(args).toContain("-L");
    expect(args).toContain("49200:127.0.0.1:38100");
  });
});

describe("controlSocketPath", () => {
  it("includes user@host-port in path", () => {
    const p = controlSocketPath({ host: "devbox", user: "james", port: 22 });
    expect(p).toContain("james@devbox-22");
  });
});

describe("parseTmuxSessionList", () => {
  it("parses tmux ls output", () => {
    const output = "t3-abc123: 1 windows (created Fri Apr 10)\nt3-def456: 1 windows";
    const sessions = parseTmuxSessionList(output);
    expect(sessions).toEqual(["t3-abc123", "t3-def456"]);
  });

  it("returns empty array for empty output", () => {
    expect(parseTmuxSessionList("")).toEqual([]);
    expect(parseTmuxSessionList("   ")).toEqual([]);
  });
});

describe("tmuxSessionName", () => {
  it("prefixes with t3-", () => {
    expect(tmuxSessionName("abc123")).toBe("t3-abc123");
  });

  it("truncates to 50 chars", () => {
    const longId = "a".repeat(100);
    expect(tmuxSessionName(longId).length).toBeLessThanOrEqual(50);
  });
});

describe("buildTmuxCheckCommand", () => {
  it("references the session name", () => {
    const cmd = buildTmuxCheckCommand("proj-abc");
    expect(cmd).toContain("t3-proj-abc");
    expect(cmd).toContain("has-session");
  });
});

describe("buildTmuxStartCommand", () => {
  it("includes projectId in session name and workspaceRoot", () => {
    const cmd = buildTmuxStartCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("t3-proj-abc");
    expect(cmd).toContain("/home/james/myapp");
    expect(cmd).toContain("new-session");
  });
});

describe("buildTmuxKillCommand", () => {
  it("includes kill-session and session name", () => {
    const cmd = buildTmuxKillCommand("proj-abc");
    expect(cmd).toContain("kill-session");
    expect(cmd).toContain("t3-proj-abc");
  });
});

describe("remote path helpers", () => {
  it("remoteServerStateFile contains projectId", () => {
    expect(remoteServerStateFile("proj-abc")).toContain("proj-abc");
    expect(remoteServerStateFile("proj-abc")).toContain("server.json");
  });

  it("remoteAuthTokenFile contains projectId", () => {
    expect(remoteAuthTokenFile("proj-abc")).toContain("proj-abc");
    expect(remoteAuthTokenFile("proj-abc")).toContain("auth-token");
  });

  it("remoteEnvFile contains projectId", () => {
    expect(remoteEnvFile("proj-abc")).toContain("proj-abc");
    expect(remoteEnvFile("proj-abc")).toContain("env");
  });
});
