import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { TerminalBrowserLaunch } from "@t3tools/client-runtime/state/terminal";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";

interface TerminalBrowserLaunchBannerProps {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
  readonly launch: TerminalBrowserLaunch;
}

/**
 * A command in the terminal asked the environment to open a page. The
 * environment never does; this banner opens it where the user is and, for a
 * sign-in that ends on a loopback page the browser cannot reach, carries that
 * page's address back to the waiting command.
 */
export function TerminalBrowserLaunchBanner({
  threadRef,
  terminalId,
  launch,
}: TerminalBrowserLaunchBannerProps) {
  const commandOptions = { reportFailure: false, reportDefect: false };
  const openLink = useOpenLink(threadRef);
  const complete = useAtomCommand(terminalEnvironment.completeBrowserLaunch, commandOptions);
  const cancel = useAtomCommand(terminalEnvironment.cancelBrowserLaunch, commandOptions);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, terminalId, captureId: launch.captureId },
  };

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Success") return true;
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Could not finish sign-in.");
      }
      return false;
    } catch {
      setError("Could not finish sign-in. Try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="grid gap-2 border-b border-border/80 bg-background px-3 py-2 text-xs"
      data-terminal-browser-launch={launch.captureId}
    >
      <p className="font-medium">
        A command in this terminal wants to open a page in your browser.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            void openLink(launch.url, {
              authRelay: {
                kind: "terminal",
                environmentId: threadRef.environmentId,
                threadId: threadRef.threadId,
                terminalId,
                captureId: launch.captureId,
                redirectUri: launch.redirectUri,
              },
            }).catch(() => {
              setError("Could not open the page. Copy the link and open it in your browser.");
            });
          }}
        >
          Open
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void writeTextToClipboard(launch.url, "Sign-in link")
              .then(() => setCopied(true))
              .catch(() => setError("Could not copy the link."));
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => void run(() => cancel(target))}
        >
          Dismiss
        </Button>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = callbackUrl.trim();
          if (!trimmed) return;
          void run(() =>
            complete({ ...target, input: { ...target.input, callbackUrl: trimmed } }),
          ).then((accepted) => {
            if (accepted) setCallbackUrl("");
          });
        }}
      >
        <label htmlFor={`terminal-browser-launch-${launch.captureId}`} className="basis-full">
          If it ends on a 127.0.0.1 or localhost page that will not load, paste that page&apos;s
          full address here.
        </label>
        <Input
          id={`terminal-browser-launch-${launch.captureId}`}
          size="sm"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="http://127.0.0.1:..."
          className="min-w-0 flex-1"
          value={callbackUrl}
          maxLength={16_384}
          disabled={pending}
          onChange={(event) => setCallbackUrl(event.target.value)}
        />
        <Button size="xs" variant="outline" type="submit" disabled={pending || !callbackUrl.trim()}>
          Continue
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
