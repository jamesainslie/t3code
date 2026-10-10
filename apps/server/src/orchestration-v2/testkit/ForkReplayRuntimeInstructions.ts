import type { ProviderReplayTranscript } from "@t3tools/contracts";

import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

const UPSTREAM_INSTRUCTIONS_END = "</pull_request_linking>";

/** The blocks Lathe appends after upstream's runtime instructions, without thread history. */
const forkInstructionsSuffix = (() => {
  const instructions = buildRuntimeInstructions({ harness: "replay" });
  return instructions.slice(
    instructions.indexOf(UPSTREAM_INSTRUCTIONS_END) + UPSTREAM_INSTRUCTIONS_END.length,
  );
})();

const withForkInstructions = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.startsWith("<runtime_info>") && value.endsWith(UPSTREAM_INSTRUCTIONS_END)
      ? `${value}${forkInstructionsSuffix}`
      : value;
  }
  if (Array.isArray(value)) return value.map(withForkInstructions);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withForkInstructions(entry)]),
    );
  }
  return value;
};

/**
 * Upstream transcripts that record runtime instructions verbatim (Muse) end at
 * upstream's last block. Appends the fork's blocks so outbound matching stays exact.
 */
export function appendForkRuntimeInstructions(
  transcript: ProviderReplayTranscript,
): ProviderReplayTranscript {
  return {
    ...transcript,
    entries: transcript.entries.map((entry) =>
      entry.type === "expect_outbound"
        ? { ...entry, frame: withForkInstructions(entry.frame) }
        : entry,
    ),
  };
}
