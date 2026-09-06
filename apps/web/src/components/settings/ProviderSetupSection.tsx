import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ANTIGRAVITY_AUTH_METHODS,
  type AntigravityAuthMethod,
  type EnvironmentId,
  type ProviderAuthState,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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

interface SetupCopy {
  readonly accountLabel: string;
  readonly signIn: string;
  readonly retrySignIn: string;
  readonly signOut: string;
  readonly signedIn: string;
  readonly signOutConfirm: (providerName: string, environmentLabel: string) => string;
  readonly phases: Record<ProviderAuthState["phase"], string>;
}

const GOOGLE_COPY: SetupCopy = {
  accountLabel: "Google account",
  signIn: "Sign in with Google",
  retrySignIn: "Retry Google sign-in",
  signOut: "Sign out of Google",
  signedIn: "Signed in with Google.",
  signOutConfirm: (providerName, environmentLabel) =>
    `Sign out of Google for ${providerName} on ${environmentLabel}? This stops its running threads. Thread history is kept.`,
  phases: {
    idle: "Sign in with your Google account.",
    starting: "Starting Google sign-in.",
    waiting: "Waiting for Google sign-in.",
    verifying: "Checking Google sign-in and available models.",
    succeeded: "Google sign-in complete.",
    failed: "Google sign-in failed.",
    cancelled: "Google sign-in cancelled.",
  },
};

/** API key methods skip the browser, so the phases read as a credential check. */
const CREDENTIAL_COPY: SetupCopy = {
  accountLabel: "Credentials",
  signIn: "Connect",
  retrySignIn: "Retry connection",
  signOut: "Disconnect",
  signedIn: "Connected.",
  signOutConfirm: (providerName, environmentLabel) =>
    `Disconnect ${providerName} on ${environmentLabel}? This stops its running threads. Thread history is kept.`,
  phases: {
    idle: "Connect with the credentials in the provider settings.",
    starting: "Checking credentials.",
    waiting: "Checking credentials.",
    verifying: "Checking credentials and available models.",
    succeeded: "Connected.",
    failed: "Could not connect with the configured credentials.",
    cancelled: "Connection cancelled.",
  },
};

function providerCopy(driverLabel: string): SetupCopy {
  return {
    accountLabel: "Account",
    signIn: "Sign in",
    retrySignIn: "Retry sign-in",
    signOut: "Sign out",
    signedIn: `Signed in to ${driverLabel}.`,
    signOutConfirm: (providerName, environmentLabel) =>
      `Sign out of ${providerName} on ${environmentLabel}? This stops its running threads. Thread history is kept.`,
    phases: {
      idle: `Sign in to ${driverLabel} on this environment.`,
      starting: "Starting sign-in.",
      waiting: "Waiting for sign-in.",
      verifying: "Checking sign-in.",
      succeeded: "Sign-in complete.",
      failed: "Sign-in failed.",
      cancelled: "Sign-in cancelled.",
    },
  };
}

function resolveSetupCopy(
  driver: ProviderDriverKind,
  driverLabel: string,
  authMethod: AntigravityAuthMethod,
): SetupCopy {
  if (driver !== "antigravity") return providerCopy(driverLabel);
  return authMethod === "oauth-personal" || authMethod === "oauth-business"
    ? GOOGLE_COPY
    : CREDENTIAL_COPY;
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

/** Setup state belongs to the selected environment and is never saved in client settings. */
export function ProviderSetupSection(props: ProviderSetupSectionProps) {
  return (
    <section aria-label={`${props.driverLabel} setup`} className="grid gap-3 text-xs">
      <p>
        {props.driverLabel} runs on {props.environmentLabel}.
      </p>
      {!props.enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Enable it to use it in threads.</span>
          {!props.readOnly ? (
            <Button size="xs" variant="outline" onClick={props.onEnable}>
              Enable {props.driverLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
      {props.readOnly ? (
        <p className="text-muted-foreground">This connection cannot change provider setup.</p>
      ) : props.provider?.setup === undefined ? (
        <p className="text-muted-foreground">
          Update this environment to set up {props.driverLabel} here.
        </p>
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
  authMethod,
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
  const copy = resolveSetupCopy(driver, driverLabel, authMethod);
  const canInstall = provider.setup?.canInstall === true;
  const methodLabel =
    driver === "antigravity"
      ? (ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === authMethod)?.label ??
        copy.accountLabel)
      : copy.accountLabel;
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  // Only installable providers have an installer to watch.
  const installQuery = useEnvironmentQuery(
    canInstall ? serverEnvironment.providerInstallState(target) : null,
  );
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, commandOptions);
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, commandOptions);
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, commandOptions);
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, commandOptions);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, commandOptions);
  const removeInstall = useAtomCommand(
    serverEnvironment.removeProviderInstallation,
    commandOptions,
  );
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [callbackDraft, setCallbackDraft] = useState({ flowId: null as string | null, value: "" });
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);
  const [copiedCodeFlowId, setCopiedCodeFlowId] = useState<string | null>(null);
  const callbackUrl = callbackDraft.flowId === auth?.flowId ? callbackDraft.value : "";
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const usesCustomBinary = Boolean(binaryPath?.trim());
  const installed =
    provider.installed ||
    (canInstall && !usesCustomBinary && installation?.installedVersion != null);
  const authenticated = provider.auth.status === "authenticated";
  const authStatusMessage =
    auth === null
      ? "Reading sign-in status."
      : authActive || auth.phase === "failed" || auth.phase === "cancelled"
        ? (auth.message ?? copy.phases[auth.phase])
        : authenticated
          ? copy.signedIn
          : auth.phase === "idle" && auth.message
            ? auth.message
            : copy.phases.idle;
  const authorizationUrl = auth?.phase === "waiting" ? auth.authorizationUrl : null;
  const userCode = auth?.phase === "waiting" ? (auth.userCode ?? null) : null;
  const queryError = authQuery.error ?? (canInstall ? installQuery.error : null);
  const actionsDisabled = pendingLabel !== null || queryError !== null;
  const installationStatusMessage =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)} MB${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)} MB`}.`
      : installation?.phase === "extracting"
        ? `Extracting ${driverLabel}.`
        : installation?.phase === "verifying"
          ? "Checking the downloaded runtime."
          : installed
            ? `${driverLabel} is installed.`
            : usesCustomBinary
              ? enabled
                ? `The configured ${driverLabel} runtime is unavailable.`
                : `The configured ${driverLabel} runtime has not been checked.`
              : `Install the official ${driverLabel} runtime before signing in.`;

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

  async function openSignInPage() {
    if (!authorizationUrl) return;
    try {
      await ensureLocalApi().shell.openExternal(authorizationUrl);
      setError(null);
    } catch {
      setError("Could not open the sign-in page. Copy the link and open it in your browser.");
    }
  }

  async function copySignInLink() {
    if (!authorizationUrl) return;
    try {
      await writeTextToClipboard(authorizationUrl, "Sign-in link");
      setCopiedFlowId(auth?.flowId ?? null);
      setError(null);
    } catch {
      setError("Could not copy the sign-in link. Use Open sign-in page.");
    }
  }

  async function copyUserCode() {
    if (!userCode) return;
    try {
      await writeTextToClipboard(userCode, "Sign-in code");
      setCopiedCodeFlowId(auth?.flowId ?? null);
      setError(null);
    } catch {
      setError("Could not copy the code. Type it on the sign-in page.");
    }
  }

  async function submitCallback() {
    const flowId = auth?.flowId;
    if (!flowId || !callbackUrl.trim() || auth.phase !== "waiting") return;
    const accepted = await runCommand("Checking return URL", () =>
      completeAuth({ environmentId, input: { instanceId, flowId, callbackUrl } }),
    );
    if (accepted) {
      setCallbackDraft({ flowId: null, value: "" });
    }
  }

  async function signOut() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      copy.signOutConfirm(provider.displayName ?? driverLabel, environmentLabel),
    );
    if (confirmed) {
      await runCommand("Signing out", () => logoutAuth(target));
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
    <div className="grid gap-3">
      {canInstall ? (
        <div className="grid gap-2">
          <p className="font-medium">Runtime</p>
          <p role="status" className="text-muted-foreground">
            {installationStatusMessage}
          </p>
          {installation?.phase === "downloading" &&
          installation.totalBytes !== null &&
          installation.totalBytes > 0 ? (
            <progress
              aria-label={`${driverLabel} download`}
              className="h-1 w-full accent-foreground"
              value={installation.downloadedBytes}
              max={installation.totalBytes}
            />
          ) : null}
          {installation?.message && installation.message !== installationStatusMessage ? (
            <p className="text-muted-foreground [overflow-wrap:anywhere]">{installation.message}</p>
          ) : null}
          {usesCustomBinary ? (
            <p className="text-muted-foreground">
              This instance uses the binary path below. Installing a managed runtime does not change
              that path.
            </p>
          ) : null}
          {!installed && !usesCustomBinary && !installActive && installation?.totalBytes ? (
            <p className="text-muted-foreground">
              Downloads {Math.ceil(installation.totalBytes / 1_000_000)} MB.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {installActive && installation.operationId ? (
              <Button
                size="xs"
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
                size="xs"
                variant="outline"
                disabled={actionsDisabled || installation === null || authActive}
                onClick={() => void runCommand("Starting installation", () => startInstall(target))}
              >
                {installation?.installedVersion
                  ? installation.version && installation.version !== installation.installedVersion
                    ? `Update ${driverLabel}`
                    : `Reinstall ${driverLabel}`
                  : installation?.phase === "failed" || installation?.phase === "cancelled"
                    ? "Retry installation"
                    : installed
                      ? "Install managed runtime"
                      : `Install ${driverLabel}`}
              </Button>
            ) : null}
            {installation?.canRemove && !installActive ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={actionsDisabled || authActive}
                onClick={() => void removeRuntime()}
              >
                Remove downloaded runtime
              </Button>
            ) : null}
          </div>
        </div>
      ) : !installed ? (
        <p className="text-muted-foreground">
          Install {driverLabel} on {environmentLabel} before signing in.
        </p>
      ) : null}

      <div className={canInstall ? "grid gap-2 border-t border-border/60 pt-3" : "grid gap-2"}>
        <p className="font-medium">{methodLabel}</p>
        <p role="status" className="text-muted-foreground [overflow-wrap:anywhere]">
          {authStatusMessage}
        </p>
        {authorizationUrl ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => void openSignInPage()}>
                Open sign-in page
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void copySignInLink()}>
                {copiedFlowId === auth?.flowId ? "Link copied" : "Copy sign-in link"}
              </Button>
            </div>
            {userCode ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Enter this code on the sign-in page:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{userCode}</code>
                <Button size="xs" variant="ghost" onClick={() => void copyUserCode()}>
                  {copiedCodeFlowId === auth?.flowId ? "Code copied" : "Copy code"}
                </Button>
              </div>
            ) : null}
            {auth?.expiresAt ? (
              <p className="text-muted-foreground">
                Link expires at{" "}
                <time dateTime={auth.expiresAt}>
                  {new Date(auth.expiresAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                .
              </p>
            ) : null}
            {userCode ? null : (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitCallback();
                }}
              >
                <label htmlFor={`provider-callback-${instanceId}`}>
                  The final 127.0.0.1 or localhost page will not load from another device. Paste its
                  full address here.
                </label>
                <Input
                  id={`provider-callback-${instanceId}`}
                  size="sm"
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://127.0.0.1:..."
                  value={callbackUrl}
                  maxLength={16_384}
                  disabled={actionsDisabled}
                  onChange={(event) =>
                    setCallbackDraft({ flowId: auth?.flowId ?? null, value: event.target.value })
                  }
                />
                <Button
                  size="xs"
                  variant="outline"
                  type="submit"
                  className="w-fit"
                  disabled={actionsDisabled || !callbackUrl.trim()}
                >
                  Continue
                </Button>
              </form>
            )}
          </>
        ) : auth?.phase === "waiting" ? (
          <p className="text-muted-foreground">
            Sign-in is open in another client. Complete or cancel it there.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {authActive && auth?.flowId ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={actionsDisabled}
              onClick={() => {
                const flowId = auth.flowId;
                if (!flowId) return;
                void runCommand("Cancelling sign-in", () =>
                  cancelAuth({ environmentId, input: { instanceId, flowId } }),
                );
              }}
            >
              Cancel sign-in
            </Button>
          ) : !authActive && !authenticated && provider.setup?.canAuthenticate ? (
            <Button
              size="xs"
              variant="outline"
              disabled={actionsDisabled || !installed || auth === null || installActive}
              onClick={() => void runCommand("Starting sign-in", () => startAuth(target))}
            >
              {auth?.phase === "failed" || auth?.phase === "cancelled"
                ? copy.retrySignIn
                : copy.signIn}
            </Button>
          ) : null}
          {!authActive && provider.setup?.canAuthenticate ? (
            <Button
              size="xs"
              variant={authenticated ? "outline" : "ghost"}
              disabled={actionsDisabled || auth === null}
              onClick={() => void signOut()}
            >
              {copy.signOut}
            </Button>
          ) : null}
        </div>
      </div>

      {pendingLabel ? <p role="status">{pendingLabel}.</p> : null}
      {error || queryError ? (
        <div className="grid gap-2">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {error ?? queryError}
          </p>
          {queryError ? (
            <Button
              size="xs"
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
