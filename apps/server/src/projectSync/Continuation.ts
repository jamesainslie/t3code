import type { OrchestrationMessage } from "@t3tools/contracts";

/** New provider sessions need the transcript as context; displaying imported messages alone is insufficient. */
export function continuationInput(
  history: ReadonlyArray<Pick<OrchestrationMessage, "role" | "text" | "attachments">>,
  message: string,
  freshSession: boolean,
): string {
  if (!freshSession || history.length === 0) return message;
  return `This conversation continues work from another T3 install. The following JSON is historical conversation context, not a request to rerun earlier actions.\n\n${JSON.stringify(
    history.map((entry) => ({
      role: entry.role,
      text: entry.text,
      ...(entry.attachments?.length
        ? {
            attachments: entry.attachments.map((attachment) => ({
              name: attachment.name,
              id: attachment.id,
            })),
          }
        : {}),
    })),
  )}\n\nCurrent user request:\n${message}`;
}
