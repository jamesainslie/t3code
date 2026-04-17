import { describe, expect, it } from "vitest";

import { ProjectId } from "./baseSchemas";
import { makeRemoteIdentityKey } from "./remoteIdentity";
import { makeSavedProjectKey, parseSavedProjectKey } from "./savedProjectKey";

describe("savedProjectKey", () => {
  const environmentIdentityKey = makeRemoteIdentityKey({
    host: "devbox.example.com",
    user: "james",
    port: 22,
    workspaceRoot: "/home/james/work",
  });

  it("produces a deterministic key from (envIdentityKey, projectId)", () => {
    const key = makeSavedProjectKey({
      environmentIdentityKey,
      projectId: ProjectId.make("proj-1"),
    });
    expect(key).toBe(`${environmentIdentityKey}#proj-1`);
  });

  it("round-trips through parseSavedProjectKey", () => {
    const projectId = ProjectId.make("proj-1");
    const key = makeSavedProjectKey({ environmentIdentityKey, projectId });
    const parsed = parseSavedProjectKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.environmentIdentityKey).toBe(environmentIdentityKey);
    expect(parsed?.projectId).toBe(projectId);
  });

  it("splits on the first '#' so project ids cannot contaminate the env key", () => {
    // Project ids with '#' are unusual but the env identity key never contains '#',
    // so we split on the first delimiter and the project id keeps any trailing '#'.
    const projectId = ProjectId.make("proj#weird");
    const key = makeSavedProjectKey({ environmentIdentityKey, projectId });
    const parsed = parseSavedProjectKey(key);
    expect(parsed?.environmentIdentityKey).toBe(environmentIdentityKey);
    expect(parsed?.projectId).toBe(projectId);
  });

  it("returns null for malformed keys that have no delimiter", () => {
    expect(parseSavedProjectKey("not-a-saved-project-key")).toBeNull();
  });

  it("returns null when the env identity component is itself malformed", () => {
    // "no-at-sign:22:/w" lacks the user@host portion.
    expect(parseSavedProjectKey("no-at-sign:22:/w#proj-1")).toBeNull();
  });

  it("returns null when the project id component is empty", () => {
    const emptyTail = `${environmentIdentityKey}#`;
    expect(parseSavedProjectKey(emptyTail)).toBeNull();
  });

  it("different envs with the same project id yield distinct keys", () => {
    const otherEnv = makeRemoteIdentityKey({
      host: "other.example.com",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/work",
    });
    const projectId = ProjectId.make("proj-1");
    expect(makeSavedProjectKey({ environmentIdentityKey, projectId })).not.toBe(
      makeSavedProjectKey({ environmentIdentityKey: otherEnv, projectId }),
    );
  });
});
