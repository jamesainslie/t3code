import {
  parseTerminalText,
  TERMINAL_PALETTE,
  terminalColorHex,
  terminalTranscript,
  type TerminalSegment,
} from "@lathe/client-runtime/work-log/terminal";
import { memo, type ReactNode } from "react";

import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { MessageCopyButton } from "./MessageCopyButton";
import { ShellCommandBlock } from "./ShellCommandBlock";

export interface TerminalOutputState {
  readonly output: string | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
}

const TerminalText = memo(function TerminalText({ text }: { readonly text: string }) {
  const { resolvedTheme } = useTheme();
  const segments = parseTerminalText(text);
  const palette = TERMINAL_PALETTE[resolvedTheme];
  return segments.map((segment: TerminalSegment, index) => {
    const { fg, bg, bold, dim, italic, underline } = segment.style;
    if (fg === undefined && bg === undefined && !bold && !dim && !italic && !underline) {
      return segment.text;
    }
    return (
      <span
        // oxlint-disable-next-line react/no-array-index-key -- segments never reorder for one output
        key={index}
        className={cn(
          bold && "font-semibold",
          dim && "opacity-60",
          italic && "italic",
          underline && "underline",
        )}
        style={{
          color: fg === undefined ? undefined : terminalColorHex(fg, palette),
          backgroundColor: bg === undefined ? undefined : terminalColorHex(bg, palette),
        }}
      >
        {segment.text}
      </span>
    );
  });
});

/**
 * Fork: a command_execution item drawn as a terminal (ported from horde): the
 * prompt and command, its ANSI-colored output, the exit code, and a button that
 * copies the whole exchange as a plain transcript for pasting into an agent.
 */
export const TerminalCard = memo(function TerminalCard(
  props: TerminalOutputState & {
    readonly command: string;
    readonly exitCode: number | undefined;
    readonly className: string;
    /** Replaces the fetched output, e.g. with a command's live output. */
    readonly outputSlot?: ReactNode;
  },
) {
  const failed = props.exitCode !== undefined && props.exitCode !== 0;
  const transcript = terminalTranscript({
    command: props.command,
    output: props.output,
    exitCode: props.exitCode,
  });
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-(--terminal-background) text-(--terminal-foreground)",
        failed ? "border-destructive/35" : "border-border/60",
      )}
      data-terminal-card
    >
      <div className="flex items-center gap-2 border-b border-border/50 py-0.5 ps-2.5 pe-1 text-muted-foreground">
        <span className="flex gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-destructive/60" />
          <span className="size-2 rounded-full bg-warning/60" />
          <span className="size-2 rounded-full bg-success/60" />
        </span>
        <span className="text-3xs tracking-wider uppercase">terminal</span>
        {props.exitCode !== undefined ? (
          <span
            className={cn("ms-auto text-3xs tracking-wide", failed && "text-destructive")}
            aria-label={`Exit code ${props.exitCode}`}
          >
            exit {props.exitCode}
          </span>
        ) : null}
        <MessageCopyButton
          text={transcript}
          label="Copy command and output"
          disabled={props.pending}
          size="icon-xs"
          variant="ghost"
          className={props.exitCode === undefined ? "ms-auto" : ""}
        />
      </div>
      <div className={cn("space-y-1.5 px-2.5 py-2", props.className)}>
        <div className="flex gap-1.5">
          <span className="shrink-0 text-success select-none" aria-hidden>
            $
          </span>
          <div className="min-w-0 flex-1">
            <ShellCommandBlock command={props.command} />
          </div>
        </div>
        {props.outputSlot ? (
          props.outputSlot
        ) : props.output ? (
          <div className="max-h-80 overflow-auto">
            <TerminalText text={props.output} />
          </div>
        ) : props.pending ? (
          <div className="text-muted-foreground italic">Loading output…</div>
        ) : props.error ? (
          <div className="text-destructive">Couldn&apos;t load output: {props.error}</div>
        ) : props.empty ? (
          <div className="text-muted-foreground italic">No output.</div>
        ) : null}
      </div>
    </div>
  );
});
