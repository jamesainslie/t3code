import { OtlpHeadersFromString, OtlpProtocol } from "@lathe/shared/observability";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const optionalBoolean = (name: string) =>
  Config.Boolean(name).pipe(Config.option, Config.map(Option.getOrElse(() => false)));

const commaSeparatedStrings = (name: string) =>
  trimmedString(name).pipe(
    Config.map(
      Option.match({
        onNone: () => [],
        onSome: (value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
      }),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  xdgDataHome: trimmedString("XDG_DATA_HOME"),
  latheHome: trimmedString("LATHE_HOME"),
  devServerUrl: Config.URL("VITE_DEV_SERVER_URL").pipe(Config.option),
  appUserModelIdOverride: trimmedString("LATHE_DESKTOP_APP_USER_MODEL_ID"),
  devRemoteLatheServerEntryPath: trimmedString("LATHE_DEV_REMOTE_LATHE_SERVER_ENTRY_PATH"),
  configuredBackendPort: Config.Port("LATHE_PORT").pipe(Config.option),
  commitHashOverride: trimmedString("LATHE_COMMIT_HASH"),
  desktopLanHostOverride: trimmedString("LATHE_DESKTOP_LAN_HOST"),
  desktopHttpsEndpointUrls: commaSeparatedStrings("LATHE_DESKTOP_HTTPS_ENDPOINTS"),
  otlpTracesUrl: trimmedString("LATHE_OTLP_TRACES_URL"),
  otlpMetricsUrl: trimmedString("LATHE_OTLP_METRICS_URL"),
  otlpLogsUrl: trimmedString("LATHE_OTLP_LOGS_URL"),
  otlpExportIntervalMs: Config.Int("LATHE_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  otlpHeaders: Config.schema(OtlpHeadersFromString, "LATHE_OTLP_HEADERS").pipe(Config.option),
  otlpProtocol: Config.schema(OtlpProtocol, "LATHE_OTLP_PROTOCOL").pipe(
    Config.withDefault("http/json"),
  ),
  desktopLauncherPath: trimmedString("LATHE_DESKTOP_LAUNCHER_PATH"),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: optionalBoolean("LATHE_DISABLE_AUTO_UPDATE"),
  mockUpdates: optionalBoolean("LATHE_DESKTOP_MOCK_UPDATES"),
  mockUpdateServerPort: Config.Port("LATHE_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.withDefault(3000),
  ),
  // Same variables and defaults as the server, so one setting raises both.
  logLevel: Config.LogLevel("LATHE_LOG_LEVEL").pipe(Config.withDefault("Info")),
  traceMinLevel: Config.LogLevel("LATHE_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
