import * as FS from "node:fs";
import * as Path from "node:path";
import type { DesktopServerExposureMode } from "@t3tools/contracts";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly transparencyEnabled: boolean;
  readonly windowOpacity: number;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  transparencyEnabled: false,
  windowOpacity: 1,
};

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function readDesktopSettings(settingsPath: string): DesktopSettings {
  try {
    if (!FS.existsSync(settingsPath)) {
      return DEFAULT_DESKTOP_SETTINGS;
    }

    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      readonly serverExposureMode?: unknown;
      readonly transparencyEnabled?: unknown;
      readonly windowOpacity?: unknown;
    };

    return {
      serverExposureMode:
        parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
      transparencyEnabled: parsed.transparencyEnabled === true,
      windowOpacity:
        typeof parsed.windowOpacity === "number" && Number.isFinite(parsed.windowOpacity)
          ? Math.max(0.5, Math.min(1.0, parsed.windowOpacity))
          : 1,
    };
  } catch {
    return DEFAULT_DESKTOP_SETTINGS;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
