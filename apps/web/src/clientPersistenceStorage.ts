import {
  ClientSettingsSchema,
  EnvironmentId,
  type ClientSettings,
  type EnvironmentId as EnvironmentIdValue,
  type PersistedSavedEnvironmentRecord,
  type PersistedSavedProjectRecord,
  type RemoteIdentityKey,
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
  environmentId: EnvironmentIdValue | RemoteIdentityKey,
): string | null {
  return (
    readBrowserSavedEnvironmentRecordsWithSecrets().find(
      (record) => record.environmentId === environmentId,
    )?.bearerToken ?? null
  );
}

export function writeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue | RemoteIdentityKey,
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

export function removeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue | RemoteIdentityKey,
): void {
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

// ---------------------------------------------------------------------------
// Theme preferences (browser-only fallback for non-desktop environments)
// ---------------------------------------------------------------------------

const THEME_PREFERENCE_KEY = "t3code:theme";
const CUSTOM_THEMES_KEY = "t3code:custom-themes:v1";
const ACTIVE_THEME_KEY = "t3code:active-theme-id:v1";

export interface BrowserThemePreferences {
  preference: "light" | "dark" | "system";
  activeThemeId: string | null;
  savedThemes: readonly unknown[];
}

export function readBrowserThemePreferences(): BrowserThemePreferences | null {
  if (!hasWindow()) return null;
  try {
    const preference = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (preference !== "light" && preference !== "dark" && preference !== "system") {
      return null;
    }
    const rawThemes = localStorage.getItem(CUSTOM_THEMES_KEY);
    const savedThemes = rawThemes ? JSON.parse(rawThemes) : [];
    const activeThemeId = localStorage.getItem(ACTIVE_THEME_KEY);
    return {
      preference,
      activeThemeId,
      savedThemes: Array.isArray(savedThemes) ? savedThemes : [],
    };
  } catch {
    return null;
  }
}

export function writeBrowserThemePreferences(prefs: BrowserThemePreferences): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, prefs.preference);
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(prefs.savedThemes));
    if (prefs.activeThemeId) {
      localStorage.setItem(ACTIVE_THEME_KEY, prefs.activeThemeId);
    } else {
      localStorage.removeItem(ACTIVE_THEME_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Markdown preferences (browser-only fallback for non-desktop environments)
// ---------------------------------------------------------------------------

// MUST match the key the T3StorageAdapter uses for `setSync({ preferences })`
// — namespace `t3code:mdreview:` + the inner key `preferences`. Drifting from
// this single source of truth silently breaks markdown settings persistence:
// the renderer reads the namespaced key, the fallback writes a different one,
// and the two halves of the system never see each other's writes.
export const MARKDOWN_PREFERENCES_STORAGE_KEY = "t3code:mdreview:preferences";

export function readBrowserMarkdownPreferences(): Record<string, unknown> | null {
  if (!hasWindow()) return null;
  try {
    const raw = localStorage.getItem(MARKDOWN_PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBrowserMarkdownPreferences(prefs: Record<string, unknown>): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(MARKDOWN_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable
  }
}
