import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import {
  ClientSettingsSchema,
  THEME_PREFERENCE_MODES,
  makeRemoteIdentityKey,
  type ClientSettings,
  type MarkdownPreferencesDocument,
  type PersistedSavedEnvironmentRecord,
  type ThemePreferencesDocument,
} from "@t3tools/contracts";
import { Predicate } from "effect";
import * as Schema from "effect/Schema";

// Re-export the document types so callers (main.ts, tests) keep their existing
// import sites — the runtime shape is unchanged, the source of truth simply
// moved into the contracts package.
export type { ThemePreferencesDocument, MarkdownPreferencesDocument };

interface ClientSettingsDocument {
  readonly settings: ClientSettings;
}

interface PersistedSavedEnvironmentStorageRecord extends PersistedSavedEnvironmentRecord {
  readonly encryptedBearerToken?: string;
}

interface SavedEnvironmentRegistryDocument {
  readonly records: readonly PersistedSavedEnvironmentStorageRecord[];
}

export interface DesktopSecretStorage {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
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
  // randomUUID avoids races between concurrent writers in the same millisecond
  // (the previous `pid + Date.now()` suffix was not unique under burst writes
  // and could collide if Electron ever spawned helper processes).
  const tempPath = `${filePath}.${Crypto.randomUUID()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

function isPersistedSavedEnvironmentStorageRecord(
  value: unknown,
): value is PersistedSavedEnvironmentStorageRecord {
  return (
    Predicate.isObject(value) &&
    typeof value.environmentId === "string" &&
    typeof value.label === "string" &&
    typeof value.httpBaseUrl === "string" &&
    typeof value.wsBaseUrl === "string" &&
    typeof value.createdAt === "string" &&
    (value.lastConnectedAt === null || typeof value.lastConnectedAt === "string") &&
    (value.encryptedBearerToken === undefined || typeof value.encryptedBearerToken === "string")
  );
}

function readSavedEnvironmentRegistryDocument(filePath: string): SavedEnvironmentRegistryDocument {
  const parsed = readJsonFile<SavedEnvironmentRegistryDocument>(filePath);
  if (!Predicate.isObject(parsed)) {
    return { records: [] };
  }

  return {
    records: Array.isArray(parsed.records)
      ? parsed.records.filter(isPersistedSavedEnvironmentStorageRecord)
      : [],
  };
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentStorageRecord,
): PersistedSavedEnvironmentRecord {
  return {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
    ...(record.sshConfig ? { sshConfig: record.sshConfig } : {}),
  };
}

export function readClientSettings(settingsPath: string): ClientSettings | null {
  const raw = readJsonFile<ClientSettingsDocument>(settingsPath)?.settings;
  if (!raw) {
    return null;
  }
  try {
    return Schema.decodeUnknownSync(ClientSettingsSchema)(raw);
  } catch {
    return null;
  }
}

export function writeClientSettings(settingsPath: string, settings: ClientSettings): void {
  writeJsonFile(settingsPath, { settings } satisfies ClientSettingsDocument);
}

export function readSavedEnvironmentRegistry(
  registryPath: string,
): readonly PersistedSavedEnvironmentRecord[] {
  return readSavedEnvironmentRegistryDocument(registryPath).records.map((record) =>
    toPersistedSavedEnvironmentRecord(record),
  );
}

export function writeSavedEnvironmentRegistry(
  registryPath: string,
  records: readonly PersistedSavedEnvironmentRecord[],
): void {
  const currentDocument = readSavedEnvironmentRegistryDocument(registryPath);
  const encryptedBearerTokenById = new Map<string, string>();
  for (const record of currentDocument.records) {
    if (record.encryptedBearerToken) {
      encryptedBearerTokenById.set(record.environmentId, record.encryptedBearerToken);
    }
  }
  writeJsonFile(registryPath, {
    records: records.map((record) => {
      const encryptedBearerToken = encryptedBearerTokenById.get(record.environmentId);
      return encryptedBearerToken
        ? {
            ...record,
            encryptedBearerToken,
          }
        : record;
    }),
  } satisfies SavedEnvironmentRegistryDocument);
}

/**
 * Returns true if `record` matches `key` either by environmentId or by a
 * identity key derived from the record's sshConfig. Secret keys may be
 * either an EnvironmentId (legacy) or a RemoteIdentityKey (current).
 */
function savedEnvironmentRecordMatchesKey(
  record: PersistedSavedEnvironmentStorageRecord,
  key: string,
): boolean {
  if (record.environmentId === key) {
    return true;
  }
  if (record.sshConfig) {
    const derivedIdentityKey = makeRemoteIdentityKey({
      host: record.sshConfig.host,
      user: record.sshConfig.user,
      port: record.sshConfig.port,
      workspaceRoot: record.sshConfig.workspaceRoot,
    });
    if (derivedIdentityKey === key) {
      return true;
    }
  }
  return false;
}

export function readSavedEnvironmentSecret(input: {
  readonly registryPath: string;
  readonly environmentId: string;
  readonly secretStorage: DesktopSecretStorage;
}): string | null {
  const document = readSavedEnvironmentRegistryDocument(input.registryPath);
  const encoded = document.records.find((record) =>
    savedEnvironmentRecordMatchesKey(record, input.environmentId),
  )?.encryptedBearerToken;
  if (!encoded) {
    return null;
  }

  if (!input.secretStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    return input.secretStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}

export function writeSavedEnvironmentSecret(input: {
  readonly registryPath: string;
  readonly environmentId: string;
  readonly secret: string;
  readonly secretStorage: DesktopSecretStorage;
}): boolean {
  const document = readSavedEnvironmentRegistryDocument(input.registryPath);

  if (!input.secretStorage.isEncryptionAvailable()) {
    return false;
  }

  let found = false;

  writeJsonFile(input.registryPath, {
    records: document.records.map((record) => {
      if (!savedEnvironmentRecordMatchesKey(record, input.environmentId)) {
        return record;
      }

      found = true;
      const encryptedBearerToken = input.secretStorage
        .encryptString(input.secret)
        .toString("base64");
      return Object.assign({}, record, {
        encryptedBearerToken,
      }) satisfies PersistedSavedEnvironmentStorageRecord;
    }),
  } satisfies SavedEnvironmentRegistryDocument);
  return found;
}

// ---------------------------------------------------------------------------
// Theme preferences
// ---------------------------------------------------------------------------

const themePreferenceValues = new Set<string>(THEME_PREFERENCE_MODES);

export function readThemePreferences(filePath: string): ThemePreferencesDocument | null {
  const parsed = readJsonFile<Record<string, unknown>>(filePath);
  if (!Predicate.isObject(parsed)) {
    return null;
  }

  // The full Schema decode is intentionally NOT used here: older docs may
  // contain custom themes that fail strict ThemeSchema decoding (e.g. shape
  // drift between schema versions), but we still want the rest of the
  // document to load. Validate the discriminating field, then preserve the
  // rest of the object so the caller can re-decode opportunistically
  // (ThemeStore.hydrateFromDesktop filters survivors via ThemeSchema).
  if (typeof parsed.preference !== "string" || !themePreferenceValues.has(parsed.preference)) {
    return null;
  }

  return {
    preference: parsed.preference as ThemePreferencesDocument["preference"],
    activeThemeId: typeof parsed.activeThemeId === "string" ? parsed.activeThemeId : null,
    savedThemes: Array.isArray(parsed.savedThemes)
      ? (parsed.savedThemes as ThemePreferencesDocument["savedThemes"])
      : [],
  };
}

export function writeThemePreferences(filePath: string, prefs: ThemePreferencesDocument): void {
  writeJsonFile(filePath, prefs);
}

// ---------------------------------------------------------------------------
// Markdown preferences
// ---------------------------------------------------------------------------

export function readMarkdownPreferences(filePath: string): MarkdownPreferencesDocument | null {
  const parsed = readJsonFile<Record<string, unknown>>(filePath);
  if (!Predicate.isObject(parsed)) {
    return null;
  }
  return parsed;
}

export function writeMarkdownPreferences(
  filePath: string,
  prefs: MarkdownPreferencesDocument,
): void {
  writeJsonFile(filePath, prefs);
}

export function removeSavedEnvironmentSecret(input: {
  readonly registryPath: string;
  readonly environmentId: string;
}): void {
  const document = readSavedEnvironmentRegistryDocument(input.registryPath);
  if (
    !document.records.some(
      (record) =>
        savedEnvironmentRecordMatchesKey(record, input.environmentId) &&
        record.encryptedBearerToken !== undefined,
    )
  ) {
    return;
  }

  writeJsonFile(input.registryPath, {
    records: document.records.map((record) => {
      if (!savedEnvironmentRecordMatchesKey(record, input.environmentId)) {
        return record;
      }

      return toPersistedSavedEnvironmentRecord(record);
    }),
  } satisfies SavedEnvironmentRegistryDocument);
}
