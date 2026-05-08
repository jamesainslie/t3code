import {
  ServerSettings,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CursorModelOptions,
  type OpenCodeModelOptions,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ServerSettingsJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

const withModelSelectionOptions = <Options>(options: Options | undefined) =>
  options ? { options } : {};

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 *
 * `projectColors` is also treated as a whole-record replacement (when present
 * in the patch). Without that, `deepMerge` accumulates entries forever and
 * removing a project color would be impossible without a sentinel value.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const projectColorsPatch = patch.projectColors;
  const next = deepMerge(current, patch);
  const withProjectColors =
    projectColorsPatch !== undefined ? { ...next, projectColors: projectColorsPatch } : next;
  if (!selectionPatch || !shouldReplaceTextGenerationModelSelection(selectionPatch)) {
    return withProjectColors;
  }

  const provider = selectionPatch.provider ?? current.textGenerationModelSelection.provider;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;

  return {
    ...withProjectColors,
    textGenerationModelSelection:
      provider === "codex"
        ? {
            provider,
            model,
            ...withModelSelectionOptions(selectionPatch.options as CodexModelOptions | undefined),
          }
        : provider === "claudeAgent"
          ? {
              provider,
              model,
              ...withModelSelectionOptions(
                selectionPatch.options as ClaudeModelOptions | undefined,
              ),
            }
          : provider === "cursor"
            ? {
                provider,
                model,
                ...withModelSelectionOptions(
                  selectionPatch.options as CursorModelOptions | undefined,
                ),
              }
            : {
                provider,
                model,
                ...withModelSelectionOptions(
                  selectionPatch.options as OpenCodeModelOptions | undefined,
                ),
              },
  };
}
