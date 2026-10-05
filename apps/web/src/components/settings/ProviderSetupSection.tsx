import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ANTIGRAVITY_AUTH_METHODS,
  type AntigravityAuthMethod,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

interface ProviderSetupSectionProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly driverLabel: string;
  readonly provider: ServerProvider | undefined;
  readonly binaryPath?: string | undefined;
  readonly authMethod?: AntigravityAuthMethod | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}

/** Read the configured method from the instance config. Unknown values fall back to personal. */
export function readAntigravityAuthMethod(config: unknown): AntigravityAuthMethod {
  const value =
    config !== null && typeof config === "object" && "authMethod" in config
      ? config.authMethod
      : undefined;
  return (
    ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === value)?.value ?? "oauth-personal"
  );
}

/** Narrow rows stack their label above the control instead of sitting beside it. */
const STACKED_ROW =
  "@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3";

/** Setup state belongs to the selected environment and is never saved in client settings. */
export function ProviderSetupSection(props: ProviderSetupSectionProps) {
  return (
    <section
      aria-label={`${props.driverLabel} setup`}
      className="@container/setup divide-y divide-border/50 text-xs"
    >
      <SettingsRow
        className={STACKED_ROW}
        title="Environment"
        description="Device that runs this provider."
        control={
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {props.environmentLabel}
            </span>
            {!props.enabled && !props.readOnly ? (
              <Button size="sm" variant="outline" onClick={props.onEnable}>
                Enable {props.driverLabel}
              </Button>
            ) : null}
          </div>
        }
      />
      {props.readOnly ? (
        <SettingsRow title="Setup unavailable" description="Provider setup is read-only." />
      ) : props.provider?.setup === undefined ? (
        <SettingsRow
          title="Update required"
          description={`Update this environment to set up ${props.driverLabel} here.`}
        />
      ) : (
        <ProviderSetupActions
          key={`${props.environmentId}:${props.instanceId}`}
          environmentId={props.environmentId}
          environmentLabel={props.environmentLabel}
          instanceId={props.instanceId}
          driver={props.driver}
          driverLabel={props.driverLabel}
          provider={props.provider}
          binaryPath={props.binaryPath}
          authMethod={props.authMethod ?? "oauth-personal"}
          enabled={props.enabled}
        />
      )}
    </section>
  );
}

function ProviderSetupActions({
  environmentId,
  environmentLabel,
  instanceId,
  driver,
  driverLabel,
  provider,
  enabled,
  binaryPath,
}: Pick<
  ProviderSetupSectionProps,
  | "environmentId"
  | "environmentLabel"
  | "instanceId"
  | "driver"
  | "driverLabel"
  | "enabled"
  | "binaryPath"
> & {
  readonly provider: ServerProvider;
  readonly authMethod: AntigravityAuthMethod;
}) {
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  // Only installable providers have an installer to watch.
  const installQuery = useEnvironmentQuery(
    canInstall ? serverEnvironment.providerInstallState(target) : null,
  );
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, commandOptions);
  const removeInstall = useAtomCommand(
    serverEnvironment.removeProviderInstallation,
    commandOptions,
  );
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const usesCustomBinary = Boolean(binaryPath?.trim());
  const installed =
    provider.installed || (!usesCustomBinary && installation?.installedVersion != null);
  const queryError = authQuery.error ?? installQuery.error;
  const actionsDisabled = pendingLabel !== null || queryError !== null;
  const installationStatusMessage =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)} MB${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)} MB`}.`
      : installation?.phase === "extracting"
        ? `Extracting ${driverLabel}.`
        : installation?.phase === "verifying"
          ? "Checking the downloaded runtime."
          : installed
            ? "Installed."
            : usesCustomBinary
              ? enabled
                ? `The configured ${driverLabel} runtime is unavailable.`
                : `The configured ${driverLabel} runtime has not been checked.`
              : installation?.totalBytes
                ? `${Math.ceil(installation.totalBytes / 1_000_000)} MB download.`
                : "Not installed.";

  async function runCommand<A, E>(
    label: string,
    request: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Provider setup failed.");
        }
        return false;
      }
      return true;
    } catch {
      setError("Provider setup failed. Try again.");
      return false;
    } finally {
      pendingRef.current = false;
      setPendingLabel(null);
    }
  }

  async function removeRuntime() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Remove the downloaded ${driverLabel} runtime from ${environmentLabel}? Sign-in and thread history are kept.`,
    );
    if (confirmed) {
      await runCommand("Removing runtime", () => removeInstall(target));
    }
  }

  return (
    <div className="divide-y divide-border/50">
      {canInstall ? (
        <SettingsRow
          title="Runtime"
          className={STACKED_ROW}
          description={`Install and manage ${driverLabel}.`}
          status={
            usesCustomBinary ? (
              <p className="text-muted-foreground">
                Uses the custom binary path below. Installation keeps that path.
              </p>
            ) : null
          }
          control={
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-56 sm:text-right">
              <p role="status" className="min-h-4 text-muted-foreground tabular-nums">
                {installationStatusMessage}
              </p>
              <div className="h-1">
                {installation?.phase === "downloading" &&
                installation.totalBytes !== null &&
                installation.totalBytes > 0 ? (
                  <progress
                    aria-label={`${driverLabel} download`}
                    className="block h-1 w-full accent-foreground"
                    value={installation.downloadedBytes}
                    max={installation.totalBytes}
                  />
                ) : null}
              </div>
              {!installActive &&
              installation?.message &&
              installation.message !== installationStatusMessage ? (
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  {installation.message}
                </p>
              ) : null}
              <div className="grid min-h-7 grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
                <div className="col-start-2 row-start-1 grid">
                  {installActive && installation.operationId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionsDisabled}
                      onClick={() => {
                        const operationId = installation.operationId;
                        if (!operationId) return;
                        void runCommand("Cancelling installation", () =>
                          cancelInstall({ environmentId, input: { instanceId, operationId } }),
                        );
                      }}
                    >
                      Cancel installation
                    </Button>
                  ) : !installActive ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionsDisabled || installation === null || authActive}
                      onClick={() =>
                        void runCommand("Starting installation", () => startInstall(target))
                      }
                    >
                      {installation?.installedVersion
                        ? installation.version &&
                          installation.version !== installation.installedVersion
                          ? `Update ${driverLabel}`
                          : `Reinstall ${driverLabel}`
                        : installation?.phase === "failed" || installation?.phase === "cancelled"
                          ? "Retry installation"
                          : installed
                            ? "Install managed runtime"
                            : `Install ${driverLabel}`}
                    </Button>
                  ) : null}
                </div>
                {installation?.canRemove && !installActive ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="col-start-1 row-start-1"
                          aria-label="Remove downloaded runtime"
                          disabled={actionsDisabled || authActive}
                          onClick={() => void removeRuntime()}
                        />
                      }
                    >
                      <Trash2Icon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup>Remove downloaded runtime</TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          }
        />
      ) : !installed ? (
        <SettingsRow
          title="Runtime"
          description={`Install ${driverLabel} on ${environmentLabel} before signing in.`}
        />
      ) : null}

      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={provider}
        readOnly={false}
      />

      <p className="sr-only" role="status">
        {pendingLabel ? `${pendingLabel}.` : null}
      </p>
      {error || queryError ? (
        <div className="grid gap-2 px-3 py-3 sm:px-4">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {error ?? queryError}
          </p>
          {queryError ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                authQuery.refresh();
                installQuery.refresh();
              }}
            >
              Retry setup status
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
