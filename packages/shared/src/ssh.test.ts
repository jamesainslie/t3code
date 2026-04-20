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
} from "./ssh.js";

describe("parseProbeOutput", () => {
  it("parses current probe output with glibc libc", () => {
    const result = parseProbeOutput("OS:Linux ARCH:aarch64 LIBC:glibc VERSION:0.0.15");
    expect(result).toEqual({
      os: "Linux",
      arch: "aarch64",
      libc: "glibc",
      currentVersion: "0.0.15",
    });
  });

  it("parses current probe output with musl libc (Alpine, Void)", () => {
    const result = parseProbeOutput("OS:Linux ARCH:x86_64 LIBC:musl VERSION:0.0.20");
    expect(result).toEqual({
      os: "Linux",
      arch: "x86_64",
      libc: "musl",
      currentVersion: "0.0.20",
    });
  });

  it("parses current probe output with empty LIBC (Darwin/BSDs)", () => {
    const result = parseProbeOutput("OS:Darwin ARCH:arm64 LIBC: VERSION:0.0.15");
    // libc field is omitted entirely rather than set to undefined — keeps
    // downstream checks like `if (probe.libc)` working without surprises.
    expect(result).toEqual({ os: "Darwin", arch: "arm64", currentVersion: "0.0.15" });
    expect(result?.libc).toBeUndefined();
  });

  it("ignores unknown LIBC values rather than propagating them", () => {
    // Defensive: if the probe script changes to report something unexpected
    // (e.g. "uclibc"), we drop the value so resolveRemotePlatform stays typed.
    const result = parseProbeOutput("OS:Linux ARCH:x86_64 LIBC:uclibc VERSION:0.0.15");
    expect(result).toEqual({ os: "Linux", arch: "x86_64", currentVersion: "0.0.15" });
    expect(result?.libc).toBeUndefined();
  });

  it("still accepts legacy probe output without LIBC field", () => {
    // Backwards compat with any older probe script that didn't emit LIBC.
    const result = parseProbeOutput("OS:Linux ARCH:aarch64 VERSION:0.0.15");
    expect(result).toEqual({ os: "Linux", arch: "aarch64", currentVersion: "0.0.15" });
  });

  it("parses empty version as empty string", () => {
    const result = parseProbeOutput("OS:Darwin ARCH:x86_64 LIBC: VERSION:");
    expect(result).toEqual({ os: "Darwin", arch: "x86_64", currentVersion: "" });
  });

  it("returns null for invalid output", () => {
    expect(parseProbeOutput("garbage")).toBeNull();
    expect(parseProbeOutput("")).toBeNull();
  });
});

describe("resolveRemotePlatform", () => {
  it("resolves Linux aarch64 with explicit glibc", () => {
    expect(resolveRemotePlatform("Linux", "aarch64", "glibc")).toEqual({
      platform: "linux",
      arch: "arm64",
      libc: "glibc",
    });
  });

  it("resolves Linux x86_64 with explicit musl", () => {
    expect(resolveRemotePlatform("Linux", "x86_64", "musl")).toEqual({
      platform: "linux",
      arch: "x64",
      libc: "musl",
    });
  });

  it("defaults Linux libc to glibc when probe didn't report it", () => {
    // Protects against older probes and keeps the common-case distro working.
    expect(resolveRemotePlatform("Linux", "x86_64")).toEqual({
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    });
  });

  it("maps amd64 to x64 (FreeBSD/Docker base-image reports it this way)", () => {
    expect(resolveRemotePlatform("Linux", "amd64")).toEqual({
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    });
  });

  it("resolves Darwin arm64 without a libc field (libc isn't meaningful on macOS)", () => {
    const result = resolveRemotePlatform("Darwin", "arm64");
    expect(result).toEqual({ platform: "darwin", arch: "arm64" });
    expect(result?.libc).toBeUndefined();
  });

  it("still resolves Darwin even if a libc argument is passed (defensive)", () => {
    // If a caller mistakenly passes libc for Darwin we ignore it rather than
    // letting a bad value leak into a binary filename.
    const result = resolveRemotePlatform("Darwin", "x86_64", "musl");
    expect(result).toEqual({ platform: "darwin", arch: "x64" });
  });

  it("returns null for Windows (no Bun target support for remote provisioning yet)", () => {
    expect(resolveRemotePlatform("Windows", "x86_64")).toBeNull();
    expect(resolveRemotePlatform("MINGW64_NT-10.0", "x86_64")).toBeNull();
  });

  it("returns null for FreeBSD (Bun has no FreeBSD target)", () => {
    expect(resolveRemotePlatform("FreeBSD", "amd64")).toBeNull();
    expect(resolveRemotePlatform("FreeBSD", "arm64")).toBeNull();
  });

  it("returns null for unsupported architectures", () => {
    expect(resolveRemotePlatform("Linux", "s390x")).toBeNull();
    expect(resolveRemotePlatform("Linux", "armv7l")).toBeNull();
    expect(resolveRemotePlatform("Linux", "i686")).toBeNull();
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

  it("passes --port 0 so every remote project gets its own ephemeral port", () => {
    // Hardcoding the default (3773) caused a collision the moment a user added
    // a second remote project against the same host. `--port 0` tells the
    // server to ask the OS for a free ephemeral port; the bound port is
    // persisted to the state file for the client tunnel to read back.
    const cmd = buildTmuxStartCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("--port 0");
  });

  it("binds to localhost-only so the ephemeral port isn't reachable off-host", () => {
    // Defense in depth: even with a random port, the server must not be
    // accessible beyond 127.0.0.1 — the SSH tunnel is the only trust boundary.
    const cmd = buildTmuxStartCommand("proj-abc", "/home/james/myapp");
    expect(cmd).toContain("--host 127.0.0.1");
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
