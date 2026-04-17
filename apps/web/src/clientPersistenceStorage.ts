import {
  ClientSettingsSchema,
  EnvironmentId,
  type ClientSettings,
  type EnvironmentId as EnvironmentIdValue,
  type PersistedSavedEnvironmentRecord,
  type PersistedSavedProjectRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
export const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";
export const SAVED_PROJECT_REGISTRY_STORAGE_KEY = "t3code:saved-project-registry:v1";

const BrowserSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  bearerToken: Schema.optionalKey(Schema.String),
});
type BrowserSavedEnvironmentRecord = typeof BrowserSavedEnvironmentRecordSchema.Type;

const BrowserSavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(BrowserSavedEnvironmentRecordSchema)),
});
type BrowserSavedEnvironmentRegistryDocument =
  typeof BrowserSavedEnvironmentRegistryDocumentSchema.Type;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentRecord,
): PersistedSavedEnvironmentRecord {
  return {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
  } catch {
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

function readBrowserSavedEnvironmentRegistryDocument(): BrowserSavedEnvironmentRegistryDocument {
  if (!hasWindow()) {
    return {};
  }

  try {
    const parsed = getLocalStorageItem(
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      BrowserSavedEnvironmentRegistryDocumentSchema,
    );
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeBrowserSavedEnvironmentRegistryDocument(
  document: BrowserSavedEnvironmentRegistryDocument,
): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
    document,
    BrowserSavedEnvironmentRegistryDocumentSchema,
  );
}

function readBrowserSavedEnvironmentRecordsWithSecrets(): ReadonlyArray<BrowserSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRegistryDocument().records ?? [];
}

function writeBrowserSavedEnvironmentRecords(
  records: ReadonlyArray<BrowserSavedEnvironmentRecord>,
): void {
  writeBrowserSavedEnvironmentRegistryDocument({
    version: 1,
    records,
  });
}

export function readBrowserSavedEnvironmentRegistry(): ReadonlyArray<PersistedSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRecordsWithSecrets().map((record) =>
    toPersistedSavedEnvironmentRecord(record),
  );
}

export function writeBrowserSavedEnvironmentRegistry(
  records: ReadonlyArray<PersistedSavedEnvironmentRecord>,
): void {
  const existing = new Map(
    readBrowserSavedEnvironmentRecordsWithSecrets().map(
      (record) => [record.environmentId, record] as const,
    ),
  );
  writeBrowserSavedEnvironmentRecords(
    records.map((record) => {
      const bearerToken = existing.get(record.environmentId)?.bearerToken;
      return bearerToken
        ? {
            environmentId: record.environmentId,
            label: record.label,
            httpBaseUrl: record.httpBaseUrl,
            wsBaseUrl: record.wsBaseUrl,
            createdAt: record.createdAt,
            lastConnectedAt: record.lastConnectedAt,
            bearerToken,
          }
        : toPersistedSavedEnvironmentRecord(record);
    }),
  );
}

export function readBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
): string | null {
  return (
    readBrowserSavedEnvironmentRecordsWithSecrets().find(
      (record) => record.environmentId === environmentId,
    )?.bearerToken ?? null
  );
}

export function writeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
  secret: string,
): boolean {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  const records = document.records ?? [];
  let found = false;
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: records.map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      found = true;
      return {
        environmentId: record.environmentId,
        label: record.label,
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
        createdAt: record.createdAt,
        lastConnectedAt: record.lastConnectedAt,
        bearerToken: secret,
      } satisfies BrowserSavedEnvironmentRecord;
    }),
  });
  return found;
}

export function removeBrowserSavedEnvironmentSecret(environmentId: EnvironmentIdValue): void {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: (document.records ?? []).map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      return toPersistedSavedEnvironmentRecord(record);
    }),
  });
}

const BrowserSavedProjectRecordSchema = Schema.Struct({
  savedProjectKey: Schema.String,
  environmentIdentityKey: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  workspaceRoot: Schema.String,
  repositoryCanonicalKey: Schema.NullOr(Schema.String),
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
  lastSyncedEnvironmentId: Schema.NullOr(Schema.String),
});

const BrowserSavedProjectRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(BrowserSavedProjectRecordSchema)),
});
type BrowserSavedProjectRegistryDocument = typeof BrowserSavedProjectRegistryDocumentSchema.Type;

function readBrowserSavedProjectRegistryDocument(): BrowserSavedProjectRegistryDocument {
  if (!hasWindow()) {
    return {};
  }

  try {
    const parsed = getLocalStorageItem(
      SAVED_PROJECT_REGISTRY_STORAGE_KEY,
      BrowserSavedProjectRegistryDocumentSchema,
    );
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function readBrowserSavedProjectRegistry(): ReadonlyArray<PersistedSavedProjectRecord> {
  return readBrowserSavedProjectRegistryDocument().records ?? [];
}

export function writeBrowserSavedProjectRegistry(
  records: ReadonlyArray<PersistedSavedProjectRecord>,
): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    SAVED_PROJECT_REGISTRY_STORAGE_KEY,
    { version: 1, records } satisfies BrowserSavedProjectRegistryDocument,
    BrowserSavedProjectRegistryDocumentSchema,
  );
}
