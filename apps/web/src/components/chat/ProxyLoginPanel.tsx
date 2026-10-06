import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  EMAIL_CODE_ADVICE,
  looksLikeEmailCode,
  type ProxyAccountView,
} from "./ProxyUsagePill.logic";

/**
 * Logs one of the gateway's accounts in again, inside the pill's ledger. The
 * gateway runs the OAuth flow; this panel starts it, shows what the user has
 * to do (paste the code an Anthropic consent page shows, or approve a Codex
 * device code on OpenAI's site) and follows the login as the server
 * publishes it, so the panel reads the same on every client.
 */
export function ProxyLoginPanel({
  environmentId,
  sourceId,
  account,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly sourceId: string;
  readonly account: ProxyAccountView;
  readonly onClose: () => void;
}) {
  const command = useAtomCommand(serverEnvironment.usageLimitSourceAccountLogin, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const login = account.login;

  const send = async (
    input: { action: "start" } | { action: "cancel" } | { action: "submit"; code: string },
  ) => {
    setBusy(true);
    setFailure(null);
    const result = await command({
      environmentId,
      input: { sourceId: sourceId as never, account: account.id, ...input },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      setFailure(
        "error" in result.cause && result.cause.error instanceof Error
          ? result.cause.error.message
          : "The gateway could not be reached.",
      );
      return false;
    }
    return true;
  };

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    // The easy mistake: Claude's emailed sign-in code pasted here. Catch it
    // before it travels; the gateway refuses it as well.
    if (looksLikeEmailCode(trimmed)) {
      setFailure(EMAIL_CODE_ADVICE);
      setCode("");
      return;
    }
    if (await send({ action: "submit", code: trimmed })) setCode("");
  };

  const cancel = async () => {
    if (login && (login.step === "paste" || login.step === "approve")) {
      await send({ action: "cancel" });
    }
    onClose();
  };

  const message = failure ?? login?.message ?? null;

  if (!login || login.step === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground">
          {login
            ? null
            : `Log ${account.id} in again. The gateway runs the login and keeps the credential; nothing is stored here.`}
        </div>
        {message ? <div className="text-error-foreground">{message}</div> : null}
        <div className="flex items-center justify-end gap-2">
          <Button size="xs" variant="ghost" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button size="xs" disabled={busy} onClick={() => void send({ action: "start" })}>
            {login ? "Start again" : "Log in"}
          </Button>
        </div>
      </div>
    );
  }

  if (login.step === "done") {
    return (
      <div className="flex flex-col gap-2">
        <div className={message ? "text-warning-foreground" : "text-success-foreground"}>
          {message ?? `Logged ${account.id} in. The gateway is using the new credential.`}
        </div>
        <div className="flex justify-end">
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (login.step === "approve") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground">
          Enter this code at OpenAI, signed in as the account this slot holds:
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm tracking-widest text-foreground">
            {login.userCode}
          </code>
          <span className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(login.userCode ?? "")
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            {login.verificationUrl ? (
              <Button
                size="xs"
                variant="outline"
                render={<a href={login.verificationUrl} target="_blank" rel="noreferrer" />}
              >
                Open OpenAI
              </Button>
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Waiting for approval…</span>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
        {message ? <div className="text-error-foreground">{message}</div> : null}
      </div>
    );
  }

  // Paste, or a code being exchanged.
  const working = login.step === "working" || busy;
  return (
    <div className="flex flex-col gap-2">
      <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
        <li>
          Open the consent page and sign in as <span className="text-foreground">{account.id}</span>
          . If Claude emails you a sign-in code, enter it on Claude&apos;s page, not here.
        </li>
        <li>Click Authorize.</li>
        <li>Claude then shows a long code with a # in it. Paste that here.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          font="mono"
          placeholder="code#state"
          autoComplete="off"
          spellCheck={false}
          aria-label="Login code"
          value={code}
          disabled={working}
          onValueChange={(value) => setCode(String(value))}
          onPaste={(event) => {
            // A paste is the whole interaction: submit what was pasted.
            const pasted = event.clipboardData.getData("text");
            if (pasted.trim()) {
              event.preventDefault();
              setCode(pasted);
              void submit(pasted);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit(code);
          }}
        />
        {login.authorizeUrl ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={login.authorizeUrl} target="_blank" rel="noreferrer" />}
          >
            Consent page
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">{working ? "Logging in…" : ""}</span>
        <span className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" disabled={working} onClick={() => void cancel()}>
            Cancel
          </Button>
          <Button size="xs" disabled={working || !code.trim()} onClick={() => void submit(code)}>
            Submit
          </Button>
        </span>
      </div>
      {message ? <div className="text-error-foreground">{message}</div> : null}
    </div>
  );
}
