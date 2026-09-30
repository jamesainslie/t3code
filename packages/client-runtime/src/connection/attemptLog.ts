import * as DateTime from "effect/DateTime";

import type { ConnectionAttemptLogEntry } from "./supervisor.ts";

/** A line of SSH output as the desktop app reports it for an environment. */
export interface SshOutputLine {
  readonly at: string;
  readonly source: string;
  readonly stderr: boolean;
  readonly text: string;
}

export type AttemptLogTone = "muted" | "success" | "warning" | "error";

const STAGE_TEXT = {
  preparing: "Preparing the connection",
  opening: "Opening the connection",
  synchronizing: "Synchronizing",
} as const;

/** How the web and mobile connection details show one attempt log entry. */
export function describeAttemptLogEntry(entry: ConnectionAttemptLogEntry): {
  readonly text: string;
  readonly tone: AttemptLogTone;
} {
  switch (entry.kind) {
    case "started":
      return { text: `Attempt ${entry.attempt}`, tone: "muted" };
    case "stage":
      return { text: STAGE_TEXT[entry.stage], tone: "muted" };
    case "connected":
      return { text: "Connected", tone: "success" };
    case "ended":
      return { text: "Connection ended", tone: "muted" };
    case "offline":
      return { text: "Waiting for the network", tone: "muted" };
    case "retrying": {
      const seconds = Math.round((entry.retryAt - entry.at) / 1000);
      return { text: seconds > 0 ? `Retrying in ${seconds}s` : "Retrying now", tone: "muted" };
    }
    case "failed": {
      const { error } = entry;
      const blocked = error._tag === "ConnectionBlockedError";
      const close = error._tag === "ConnectionTransientError" ? error.socketClose : undefined;
      const parts = [`${blocked ? "Blocked" : "Failed"} (${error.reason}): ${error.detail}`];
      if (close !== undefined) {
        const code = close.code === undefined ? "" : ` with code ${close.code}`;
        const reason = close.reason === undefined ? "" : ` (${close.reason})`;
        const clean =
          close.wasClean === undefined ? "" : close.wasClean ? ", cleanly" : ", not cleanly";
        parts.push(`Socket closed${code}${reason}${clean}.`);
      }
      if (error.traceId !== undefined) parts.push(`Trace ${error.traceId}.`);
      return { text: parts.join(" "), tone: blocked ? "error" : "warning" };
    }
  }
}

/** The attempt log, then any SSH output, as plain text for copying into a bug report. */
export function attemptLogToText(
  entries: ReadonlyArray<ConnectionAttemptLogEntry>,
  sshOutput: ReadonlyArray<SshOutputLine> = [],
): string {
  const lines = entries.map(
    (entry) =>
      `${DateTime.formatIso(DateTime.makeUnsafe(entry.at))} ${describeAttemptLogEntry(entry).text}`,
  );
  if (sshOutput.length > 0) {
    lines.push(
      "",
      "SSH output",
      ...sshOutput.map(
        (entry) => `${entry.at} [${entry.source}${entry.stderr ? " stderr" : ""}] ${entry.text}`,
      ),
    );
  }
  return lines.join("\n");
}
