import { describe, it, expect } from "vitest";
import { makeRemoteIdentityKey, parseRemoteIdentityKey } from "./remoteIdentity.ts";

describe("RemoteIdentityKey", () => {
  it("creates a stable key from host+user+port+workspaceRoot", () => {
    const key = makeRemoteIdentityKey({
      host: "devbox.example.com",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/myapp",
    });
    expect(key).toBe("james@devbox.example.com:22:/home/james/myapp");
  });

  it("produces different keys for different workspaces on same host", () => {
    const a = makeRemoteIdentityKey({
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app1",
    });
    const b = makeRemoteIdentityKey({
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app2",
    });
    expect(a).not.toBe(b);
  });

  it("roundtrips through parse", () => {
    const input = { host: "devbox", user: "james", port: 2222, workspaceRoot: "/opt/code" };
    const key = makeRemoteIdentityKey(input);
    const parsed = parseRemoteIdentityKey(key);
    expect(parsed).toEqual(input);
  });

  it("parse returns null for invalid keys", () => {
    expect(parseRemoteIdentityKey("garbage")).toBeNull();
  });
});
