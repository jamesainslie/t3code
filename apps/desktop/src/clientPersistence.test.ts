import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  EnvironmentId,
  makeRemoteIdentityKey,
  type ClientSettings,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  readClientSettings,
  readMarkdownPreferences,
  readSavedEnvironmentRegistry,
  readSavedEnvironmentSecret,
  readThemePreferences,
  removeSavedEnvironmentSecret,
  writeClientSettings,
  writeMarkdownPreferences,
  writeSavedEnvironmentRegistry,
  writeSavedEnvironmentSecret,
  writeThemePreferences,
  type DesktopSecretStorage,
  type ThemePreferencesDocument,
} from "./clientPersistence.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempPath(fileName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-client-persistence-test-"));
  tempDirectories.push(directory);
  return path.join(directory, fileName);
}

function makeSecretStorage(available: boolean): DesktopSecretStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("enc:")) {
        throw new Error("invalid secret");
      }
      return decoded.slice("enc:".length);
    },
  };
}

const clientSettings: ClientSettings = {
  confirmThreadArchive: true,
  confirmThreadDelete: false,
  diffWordWrap: true,
  favorites: [],
  sidebarProjectGroupingMode: "repository_path",
  sidebarProjectGroupingOverrides: {
    "environment-1:/tmp/project-a": "separate",
  },
  sidebarProjectSortOrder: "manual",
  sidebarThreadSortOrder: "created_at",
  timestampFormat: "24-hour",
};

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: "2026-04-09T01:00:00.000Z",
};

describe("clientPersistence", () => {
  it("persists and reloads client settings", () => {
    const settingsPath = makeTempPath("client-settings.json");

    writeClientSettings(settingsPath, clientSettings);

    expect(readClientSettings(settingsPath)).toEqual(clientSettings);
  });

  it("persists and reloads saved environment metadata", () => {
    const registryPath = makeTempPath("saved-environments.json");

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(readSavedEnvironmentRegistry(registryPath)).toEqual([savedRegistryRecord]);
  });

  it("persists encrypted saved environment secrets when encryption is available", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      }),
    ).toBe(true);

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBe("bearer-token");

    expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toEqual({
      records: [
        {
          ...savedRegistryRecord,
          encryptedBearerToken: Buffer.from("enc:bearer-token", "utf8").toString("base64"),
        },
      ],
    });
  });

  it("preserves existing secrets when encryption is unavailable", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const availableSecretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage: availableSecretStorage,
    });

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "next-token",
        secretStorage: makeSecretStorage(false),
      }),
    ).toBe(false);

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: availableSecretStorage,
      }),
    ).toBe("bearer-token");
  });

  it("removes saved environment secrets", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage,
    });

    removeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
    });

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBeNull();
  });

  it("treats malformed secrets documents as empty", () => {
    const registryPath = makeTempPath("saved-environments.json");
    fs.writeFileSync(registryPath, "{}\n", "utf8");

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: makeSecretStorage(true),
      }),
    ).toBeNull();

    expect(() =>
      removeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
      }),
    ).not.toThrow();
  });

  it("returns false when writing a secret without metadata", () => {
    const registryPath = makeTempPath("saved-environments.json");

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage: makeSecretStorage(true),
      }),
    ).toBe(false);
  });

  it("preserves encrypted secrets when metadata is rewritten", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage,
    });

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(readSavedEnvironmentRegistry(registryPath)).toEqual([savedRegistryRecord]);
    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBe("bearer-token");
  });

  describe("identity-key keyed secrets (sshConfig records)", () => {
    const sshConfig = {
      host: "hephaestus",
      user: "james",
      port: 22,
      projectId: "proj-1",
      workspaceRoot: "/workspace",
    };
    const identityKey = makeRemoteIdentityKey(sshConfig);
    const sshRecord: PersistedSavedEnvironmentRecord = {
      ...savedRegistryRecord,
      sshConfig,
    };

    it("writes a secret keyed by identityKey and reads it back", () => {
      const registryPath = makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      writeSavedEnvironmentRegistry(registryPath, [sshRecord]);

      expect(
        writeSavedEnvironmentSecret({
          registryPath,
          environmentId: identityKey,
          secret: "bearer-token",
          secretStorage,
        }),
      ).toBe(true);

      expect(
        readSavedEnvironmentSecret({
          registryPath,
          environmentId: identityKey,
          secretStorage,
        }),
      ).toBe("bearer-token");
    });

    it("still matches legacy secrets keyed by environmentId", () => {
      const registryPath = makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      writeSavedEnvironmentRegistry(registryPath, [sshRecord]);

      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: sshRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      });

      expect(
        readSavedEnvironmentSecret({
          registryPath,
          environmentId: sshRecord.environmentId,
          secretStorage,
        }),
      ).toBe("bearer-token");
    });

    it("removes a secret looked up by identityKey", () => {
      const registryPath = makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      writeSavedEnvironmentRegistry(registryPath, [sshRecord]);
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: identityKey,
        secret: "bearer-token",
        secretStorage,
      });

      removeSavedEnvironmentSecret({
        registryPath,
        environmentId: identityKey,
      });

      expect(
        readSavedEnvironmentSecret({
          registryPath,
          environmentId: identityKey,
          secretStorage,
        }),
      ).toBeNull();
    });

    it("preserves sshConfig when roundtripping through read/write", () => {
      const registryPath = makeTempPath("saved-environments.json");

      writeSavedEnvironmentRegistry(registryPath, [sshRecord]);

      const reloaded = readSavedEnvironmentRegistry(registryPath);
      expect(reloaded).toEqual([sshRecord]);
      expect(reloaded[0]?.sshConfig).toEqual(sshConfig);
    });
  });

  describe("theme preferences", () => {
    it("returns null when file does not exist", () => {
      const filePath = makeTempPath("theme-preferences.json");
      expect(readThemePreferences(filePath)).toBeNull();
    });

    it("round-trips theme preferences", () => {
      const filePath = makeTempPath("theme-preferences.json");
      const prefs: ThemePreferencesDocument = {
        preference: "dark",
        activeThemeId: "monokai",
        savedThemes: [{ id: "monokai", name: "Monokai" }],
      };

      writeThemePreferences(filePath, prefs);

      expect(readThemePreferences(filePath)).toEqual(prefs);
    });

    it("returns null for corrupt JSON", () => {
      const filePath = makeTempPath("theme-preferences.json");
      fs.writeFileSync(filePath, "not json at all", "utf8");

      expect(readThemePreferences(filePath)).toBeNull();
    });

    it("returns null when preference field is invalid", () => {
      const filePath = makeTempPath("theme-preferences.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ preference: "rainbow", activeThemeId: null, savedThemes: [] }),
        "utf8",
      );

      expect(readThemePreferences(filePath)).toBeNull();
    });

    it("normalizes missing activeThemeId to null", () => {
      const filePath = makeTempPath("theme-preferences.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ preference: "system", savedThemes: [{ id: "a" }] }),
        "utf8",
      );

      const result = readThemePreferences(filePath);
      expect(result).toEqual({
        preference: "system",
        activeThemeId: null,
        savedThemes: [{ id: "a" }],
      });
    });

    it("normalizes missing savedThemes to empty array", () => {
      const filePath = makeTempPath("theme-preferences.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ preference: "light", activeThemeId: "solarized" }),
        "utf8",
      );

      const result = readThemePreferences(filePath);
      expect(result).toEqual({
        preference: "light",
        activeThemeId: "solarized",
        savedThemes: [],
      });
    });
  });

  describe("markdown preferences", () => {
    it("returns null when file does not exist", () => {
      const filePath = makeTempPath("markdown-preferences.json");
      expect(readMarkdownPreferences(filePath)).toBeNull();
    });

    it("round-trips markdown preferences", () => {
      const filePath = makeTempPath("markdown-preferences.json");
      const prefs = { codeBlockTheme: "github-dark", fontSize: 14 };

      writeMarkdownPreferences(filePath, prefs);

      expect(readMarkdownPreferences(filePath)).toEqual(prefs);
    });

    it("returns null for corrupt JSON", () => {
      const filePath = makeTempPath("markdown-preferences.json");
      fs.writeFileSync(filePath, "{{broken", "utf8");

      expect(readMarkdownPreferences(filePath)).toBeNull();
    });
  });
});
