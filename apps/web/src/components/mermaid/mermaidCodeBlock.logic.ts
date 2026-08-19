export type MermaidTab = "preview" | "source";
export type MermaidView = "diagram" | "source";

/**
 * Quiet period a streamed mermaid source must hold before a render is
 * attempted. Streaming appends tokens far faster than this, so a truncated
 * fence never reaches mermaid.render; once the fence closes the source stops
 * changing and the diagram renders while the rest of the message streams.
 */
export const MERMAID_STREAM_SETTLE_MS = 350;

export interface MermaidViewInput {
  activeTab: MermaidTab;
  failed: boolean;
  isSettled: boolean;
}

export function resolveMermaidView({
  activeTab,
  failed,
  isSettled,
}: MermaidViewInput): MermaidView {
  if (failed || !isSettled) {
    return "source";
  }
  return activeTab === "preview" ? "diagram" : "source";
}

const MAX_ERROR_SUMMARY_LENGTH = 200;

export function summarizeMermaidError(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) {
    return "Diagram failed to render";
  }
  if (singleLine.length <= MAX_ERROR_SUMMARY_LENGTH) {
    return singleLine;
  }
  return `${singleLine.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…`;
}
