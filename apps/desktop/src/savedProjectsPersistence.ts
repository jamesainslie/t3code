import * as FS from "node:fs";
import * as Path from "node:path";

import type { PersistedSavedProjectRecord } from "@t3tools/contracts";
import { Predicate } from "effect";

interface SavedProjectRegistryDocument {
  readonly records: readonly PersistedSavedProjectRecord[];
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!FS.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const directory = Path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

function isPersistedSavedProjectRecord(value: unknown): value is PersistedSavedProjectRecord {
  return (
    Predicate.isObject(value) &&
    typeof value.savedProjectKey === "string" &&
    typeof value.environmentIdentityKey === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    typeof value.workspaceRoot === "string" &&
    (value.repositoryCanonicalKey === null || typeof value.repositoryCanonicalKey === "string") &&
    typeof value.firstSeenAt === "string" &&
    typeof value.lastSeenAt === "string" &&
    (value.lastSyncedEnvironmentId === null || typeof value.lastSyncedEnvironmentId === "string")
  );
}

export function readSavedProjectRegistry(
  registryPath: string,
): readonly PersistedSavedProjectRecord[] {
  const parsed = readJsonFile<SavedProjectRegistryDocument>(registryPath);
  if (!Predicate.isObject(parsed) || !Array.isArray(parsed.records)) {
    return [];
  }
  return parsed.records.filter(isPersistedSavedProjectRecord);
}

export function writeSavedProjectRegistry(
  registryPath: string,
  records: readonly PersistedSavedProjectRecord[],
): void {
  writeJsonFile(registryPath, { records } satisfies SavedProjectRegistryDocument);
}
