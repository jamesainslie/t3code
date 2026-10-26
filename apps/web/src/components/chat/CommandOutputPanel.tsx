import type { CommandOutputView } from "@lathe/client-runtime/state/command-output";
import type { EnvironmentId, ThreadId, TurnItemId } from "@lathe/contracts";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@lathe/shared/terminalOutput";
import { useLayoutEffect, useRef } from "react";

import { useTheme } from "../../hooks/useTheme";
import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import type { TerminalOutputState } from "./TerminalCard";
import type { TurnItemSource } from "./timelineRowContext";

const FOLLOW_SLACK_PX = 8;

export function useCommandOutputStreaming(environmentId: EnvironmentId): boolean {
  return (
    useServerConfigs().get(environmentId)?.environment.capabilities.commandOutputStreaming === true
  );
}

/**
 * Fork: the streamed output as the terminal card's copy state. It reads the
 * query the panel subscribes to, so the copied transcript is the final output,
 * and copying stays disabled until the command has finished.
 */
export function useStreamedTerminalOutput(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly source?: TurnItemSource["commandOutput"] | undefined;
}): TerminalOutputState {
  const input = { threadId: props.threadId, itemId: props.itemId };
  const { data, error } = useEnvironmentQuery<CommandOutputView, unknown>(
    props.source
      ? props.source(input)
      : orchestrationEnvironment.v2.commandOutput({ environmentId: props.environmentId, input }),
  );
  const finished = data !== null && data !== undefined && !data.running;
  const text = finished ? data.output.text : "";
  return {
    output: text.length > 0 ? text : null,
    pending: !finished && !error,
    error: error ?? null,
    empty: finished && text.length === 0,
  };
}

/**
 * Output of one expanded command row: streams while the command runs, then
 * shows its final output. Mount it only when `useCommandOutputStreaming` holds
 * or a `source` serves the output.
 * It subscribes only while mounted, so collapsed rows and other threads receive nothing.
 */
export function CommandOutputPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly source?: TurnItemSource["commandOutput"] | undefined;
}) {
  const input = { threadId: props.threadId, itemId: props.itemId };
  const { data, error } = useEnvironmentQuery<CommandOutputView, unknown>(
    props.source
      ? props.source(input)
      : orchestrationEnvironment.v2.commandOutput({ environmentId: props.environmentId, input }),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  if (text.length === 0) {
    if (error) return <div className="text-destructive">Couldn&apos;t load output: {error}</div>;
    if (data === null) return <div className="text-muted-foreground italic">Loading output…</div>;
    return data.running ? null : <div className="text-muted-foreground italic">No output.</div>;
  }
  // Parse after all hooks to preserve the text/theme compiler cache.
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <div>
      {data?.output.truncated ? (
        <div className="text-muted-foreground italic">Earlier output not shown</div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="max-h-80 overflow-auto text-muted-foreground"
      >
        {spans.map((span, index) =>
          span.style === null ? (
            span.text
          ) : (
            // Spans never reorder and are rebuilt on each update.
            // oxlint-disable-next-line react/no-array-index-key
            <span key={index} style={span.style}>
              {span.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
