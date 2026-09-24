import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UnifiedSettings, UsageLimitSourceSnapshot } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const KIND_LABEL = { cliproxy: "CLI Proxy", modelproxy: "modelproxy gateway" } as const;

/** Source management follows the selected device and access rules of provider settings. */
export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const snapshots = serverConfig?.usageLimitSources ?? [];
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(sources);

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3" aria-hidden />
              Add source
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow title="No usage providers configured." />
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            const snapshot = snapshots.find((candidate) => candidate.id === id);
            return (
              <SettingsRow
                key={id}
                title={label}
                description={
                  <span className="break-all">
                    {KIND_LABEL[source.kind]}
                    {source.enabled ? "" : " · Disabled"}
                    {label !== source.url ? ` · ${source.url}` : ""}
                    {source.kind === "modelproxy" ? (
                      <GatewayAuthStatus snapshot={snapshot} />
                    ) : null}
                  </span>
                }
                control={
                  !readOnly ? (
                    <span className="flex items-center gap-1">
                      {source.kind === "modelproxy" ? (
                        <GatewayAuthButton
                          environmentId={environmentId}
                          sourceId={id}
                          snapshot={snapshot}
                        />
                      ) : null}
                      <RemoveUsageProviderButton
                        label={label}
                        kind={source.kind}
                        onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                      />
                    </span>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
        />
      ) : null}
    </>
  );
}

function GatewayAuthStatus({
  snapshot,
}: {
  readonly snapshot: UsageLimitSourceSnapshot | undefined;
}) {
  const auth = snapshot?.proxy?.auth;
  if (!auth) return null;
  if (auth.state === "signedIn") return <> · Signed in</>;
  if (auth.state === "pending") {
    return (
      <>
        {" "}
        · Confirm device code <code className="font-mono tracking-widest">
          {auth.userCode}
        </code> at{" "}
        <a
          className="underline"
          href={auth.verificationUrlComplete ?? auth.verificationUrl}
          target="_blank"
          rel="noreferrer"
        >
          {auth.verificationUrl}
        </a>
        , then sign in with your password and a passkey or authenticator code. This row updates when
        you finish.
      </>
    );
  }
  return <> · Not signed in</>;
}

function GatewayAuthButton({
  environmentId,
  sourceId,
  snapshot,
}: {
  readonly environmentId: EnvironmentId;
  readonly sourceId: string;
  readonly snapshot: UsageLimitSourceSnapshot | undefined;
}) {
  const auth = useAtomCommand(serverEnvironment.usageLimitSourceAuth);
  const state = snapshot?.proxy?.auth.state ?? "signedOut";
  const action = state === "signedIn" ? "signOut" : state === "pending" ? "cancel" : "start";
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => void auth({ environmentId, input: { sourceId: sourceId as never, action } })}
    >
      {state === "signedIn" ? "Sign out" : state === "pending" ? "Cancel sign-in" : "Sign in"}
    </Button>
  );
}

/** Removing a source deletes its stored secret, so it requires confirmation. */
function RemoveUsageProviderButton({
  label,
  kind,
  onConfirm,
}: {
  readonly label: string;
  readonly kind: keyof typeof KIND_LABEL;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const noun = kind === "cliproxy" ? "hub" : "gateway";
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === "cliproxy"
                ? "The hub's management key is deleted from this server."
                : "The gateway's client secret and your sign-in session are deleted from this server."}{" "}
              Its accounts leave the Limits view; the {noun} itself is untouched. Add it again to
              bring them back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove {noun}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
