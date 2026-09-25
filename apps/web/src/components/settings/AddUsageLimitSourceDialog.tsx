import { type EnvironmentId, UsageLimitSourceId } from "@t3tools/contracts";
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
import { Label } from "../ui/label";

type SourceKind = "cliproxy" | "modelproxy";

/**
 * Stable per source and readable in settings.json. Dots and dashes in the
 * host are kept so `foo-bar.com` and `foo.bar.com` do not collide; anything
 * else (a port's colon, a path) is folded to a dash.
 */
function sourceIdFromUrl(kind: SourceKind, url: string): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw text; the server reports the bad URL on its row.
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`${kind}-${slug || (kind === "cliproxy" ? "hub" : "gateway")}`);
}

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

/**
 * Adds a usage-limit source from provider settings on one environment. The
 * secret is sent once and kept in that server's secret store; settings only
 * ever carry a redaction marker for it afterwards.
 */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
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
    const id = sourceIdFromUrl(kind, trimmedUrl);
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
                    placeholder="t3-code"
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
              <Input
                id="usage-source-key"
                type="password"
                autoComplete="off"
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
