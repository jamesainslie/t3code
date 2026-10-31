import { type EnvironmentId, type UnifiedSettings, UsageLimitSourceId } from "@lathe/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { sourceIdFromUrl } from "./AddUsageLimitSourceDialog.logic";
import { SecretInput } from "./SecretInput";
import { Label } from "../ui/label";

type SourceKind = "cliproxy" | "modelproxy";

const KIND_COPY: Record<SourceKind, { title: string; description: string; action: string }> = {
  cliproxy: {
    title: "CLIProxyAPI hub",
    description: "Show the quota of every account the hub pools. The management key stays on",
    action: "Add hub",
  },
  modelproxy: {
    title: "modelproxy gateway",
    description:
      "Show which account the gateway is serving and how much headroom the pool has. You sign in as yourself; the client secret and your session stay on",
    action: "Add gateway",
  },
};

/** Send the secret once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [kind, setKind] = useState<SourceKind>("cliproxy");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const trimmedUrl = url.trim();
  const canSave =
    trimmedUrl.length > 0 &&
    secret.trim().length > 0 &&
    (kind === "cliproxy" || (issuer.trim().length > 0 && clientId.trim().length > 0));

  const reset = () => {
    setKind("cliproxy");
    setLabel("");
    setUrl("");
    setSecret("");
    setIssuer("");
    setClientId("");
  };

  const save = () => {
    if (!canSave) return;
    const hubId = sourceIdFromUrl(trimmedUrl, sources);
    // Fork: a gateway takes its own prefix; a saved URL keeps the ID it already has.
    const id =
      kind === "cliproxy"
        ? hubId
        : UsageLimitSourceId.make(hubId.replace(/^cliproxy-/, "modelproxy-"));
    const common = {
      ...(label.trim() ? { label: label.trim() } : {}),
      url: trimmedUrl,
      enabled: true,
    };
    // The patch names only this entry; the server merges it into its map.
    updateSettings({
      usageLimitSources: {
        [id]:
          kind === "cliproxy"
            ? { kind, ...common, managementKey: secret.trim() }
            : {
                kind,
                ...common,
                issuer: issuer.trim(),
                clientId: clientId.trim(),
                clientSecret: secret.trim(),
              },
      },
    });
    reset();
    onOpenChange(false);
  };

  const copy = KIND_COPY[kind];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a {copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description} {environmentLabel}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label>Kind</Label>
              <div className="flex gap-1" role="radiogroup" aria-label="Source kind">
                {(["cliproxy", "modelproxy"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="xs"
                    role="radio"
                    aria-checked={kind === option}
                    variant={kind === option ? "default" : "outline"}
                    onClick={() => setKind(option)}
                  >
                    {KIND_COPY[option].title}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {kind === "cliproxy" ? "Hub URL" : "Gateway URL"}
              </Label>
              <Input
                id="usage-source-url"
                placeholder={
                  kind === "cliproxy"
                    ? "https://hub.example.ts.net:8318"
                    : "https://iris.example.com"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            {kind === "modelproxy" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="usage-source-issuer">OIDC issuer</Label>
                  <Input
                    id="usage-source-issuer"
                    placeholder="https://auth.example.com/realms/main"
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="usage-source-client-id">Client ID</Label>
                  <Input
                    id="usage-source-client-id"
                    placeholder="lathe"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {kind === "cliproxy" ? "Management key" : "Client secret"}
              </Label>
              <SecretInput
                id="usage-source-key"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">Label (optional)</Label>
              <Input
                id="usage-source-label"
                placeholder="Defaults to the host name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {copy.action}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
