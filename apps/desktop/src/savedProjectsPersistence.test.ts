import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PersistedSavedProjectRecord } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { readSavedProjectRegistry, writeSavedProjectRegistry } from "./savedProjectsPersistence";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempPath(fileName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-saved-projects-test-"));
  tempDirectories.push(directory);
  return path.join(directory, fileName);
}

const record: PersistedSavedProjectRecord = {
  savedProjectKey: "james@devbox.example.com:22:/home/james/work#proj-1",
  environmentIdentityKey: "james@devbox.example.com:22:/home/james/work",
  projectId: "proj-1",
  name: "monorepo",
  workspaceRoot: "/home/james/work/monorepo",
  repositoryCanonicalKey: "github.com/james/monorepo",
  firstSeenAt: "2026-04-16T00:00:00.000Z",
  lastSeenAt: "2026-04-16T00:00:00.000Z",
  lastSyncedEnvironmentId: "environment-1",
};

describe("savedProjectsPersistence", () => {
  it("returns an empty array when the file does not exist", () => {
    expect(readSavedProjectRegistry(makeTempPath("saved-projects.json"))).toEqual([]);
  });

  it("round-trips a single record", () => {
    const registryPath = makeTempPath("saved-projects.json");
    writeSavedProjectRegistry(registryPath, [record]);
    expect(readSavedProjectRegistry(registryPath)).toEqual([record]);
  });

  it("round-trips multiple records and preserves order", () => {
    const registryPath = makeTempPath("saved-projects.json");
    const second: PersistedSavedProjectRecord = {
      ...record,
      savedProjectKey: `${record.environmentIdentityKey}#proj-2`,
      projectId: "proj-2",
      name: "docs",
      workspaceRoot: "/home/james/work/docs",
    };
    writeSavedProjectRegistry(registryPath, [record, second]);
    expect(readSavedProjectRegistry(registryPath)).toEqual([record, second]);
  });

  it("treats missing optional fields as null when reading", () => {
    const registryPath = makeTempPath("saved-projects.json");
    const minimal: PersistedSavedProjectRecord = {
      ...record,
      repositoryCanonicalKey: null,
      lastSyncedEnvironmentId: null,
    };
    writeSavedProjectRegistry(registryPath, [minimal]);
    expect(readSavedProjectRegistry(registryPath)).toEqual([minimal]);
  });

  it("returns an empty array when the file is not valid JSON", () => {
    const registryPath = makeTempPath("saved-projects.json");
    fs.writeFileSync(registryPath, "{not-json", "utf8");
    expect(readSavedProjectRegistry(registryPath)).toEqual([]);
  });

  it("drops individual malformed records while keeping valid ones", () => {
    const registryPath = makeTempPath("saved-projects.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        records: [
          record,
          { savedProjectKey: "bogus" }, // missing required fields
          null,
          "not-an-object",
        ],
      }),
      "utf8",
    );
    expect(readSavedProjectRegistry(registryPath)).toEqual([record]);
  });

  it("returns empty when the document has no records array", () => {
    const registryPath = makeTempPath("saved-projects.json");
    fs.writeFileSync(registryPath, JSON.stringify({ records: "nope" }), "utf8");
    expect(readSavedProjectRegistry(registryPath)).toEqual([]);
  });

  it("writes atomically by using a temp file and rename", () => {
    const registryPath = makeTempPath("saved-projects.json");
    writeSavedProjectRegistry(registryPath, [record]);
    const leftoverTmpFiles = fs
      .readdirSync(path.dirname(registryPath))
      .filter((name) => name.endsWith(".tmp"));
    expect(leftoverTmpFiles).toEqual([]);
  });

  it("creates the parent directory when it does not exist", () => {
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-saved-projects-nested-"));
    tempDirectories.push(nestedDir);
    const registryPath = path.join(nestedDir, "deeper", "saved-projects.json");
    writeSavedProjectRegistry(registryPath, [record]);
    expect(readSavedProjectRegistry(registryPath)).toEqual([record]);
  });
});
