import type { DesktopSshOutputEntry } from "@t3tools/contracts";
import { redactSshOutput } from "@t3tools/ssh/command";
import type { SshOutputChunk } from "@t3tools/ssh/output";

export interface SshOutputBufferOptions {
  readonly maxLines?: number;
  readonly maxLineLength?: number;
}

/**
 * One SSH target's recent output as whole, redacted lines. Chunks can split lines (and the
 * tokens inside them), so each source and stream keeps its unfinished line until it completes
 * or an attempt marker flushes it. Blank lines are dropped.
 */
export function makeSshOutputBuffer(options: SshOutputBufferOptions = {}) {
  const maxLines = options.maxLines ?? 500;
  const maxLineLength = options.maxLineLength ?? 2_000;
  const entries: DesktopSshOutputEntry[] = [];
  const unfinished = new Map<string, { readonly chunk: SshOutputChunk; readonly text: string }>();
  let seq = 0;

  const add = (
    at: string,
    source: DesktopSshOutputEntry["source"],
    stderr: boolean,
    raw: string,
  ): DesktopSshOutputEntry | null => {
    const line = redactSshOutput(raw).trimEnd();
    if (line.trim().length === 0) return null;
    seq += 1;
    const entry: DesktopSshOutputEntry = {
      seq,
      at,
      source,
      stderr,
      text: line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line,
    };
    entries.push(entry);
    if (entries.length > maxLines) entries.splice(0, entries.length - maxLines);
    return entry;
  };
  const present = (entry: DesktopSshOutputEntry | null): entry is DesktopSshOutputEntry =>
    entry !== null;

  return {
    /** Adds a chunk and returns the lines it completed. */
    append(chunk: SshOutputChunk, at: string): DesktopSshOutputEntry[] {
      const key = `${chunk.source}\0${chunk.stream}`;
      const parts = `${unfinished.get(key)?.text ?? ""}${chunk.text}`.split(/\r\n|\n|\r/u);
      unfinished.set(key, { chunk, text: parts.pop() ?? "" });
      return parts
        .map((part) => add(at, chunk.source, chunk.stream === "stderr", part))
        .filter(present);
    },
    /** Flushes unfinished lines, then records an attempt marker; returns what it added. */
    mark(text: string, at: string): DesktopSshOutputEntry[] {
      const flushed = [...unfinished.values()].map(({ chunk, text: rest }) =>
        add(at, chunk.source, chunk.stream === "stderr", rest),
      );
      unfinished.clear();
      return [...flushed, add(at, "status", false, text)].filter(present);
    },
    entries(): ReadonlyArray<DesktopSshOutputEntry> {
      return entries;
    },
  };
}

export type SshOutputBuffer = ReturnType<typeof makeSshOutputBuffer>;
