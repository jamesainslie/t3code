import * as OS from "node:os";
import * as NodePath from "node:path";

import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";

interface KubeConfig {
  readonly "current-context"?: string;
  readonly contexts?: readonly {
    readonly name: string;
    readonly context?: {
      readonly cluster?: string;
      readonly user?: string;
      readonly namespace?: string;
    };
  }[];
}

/**
 * Minimal YAML parser for kubeconfig files.
 * Kubeconfig is a well-structured YAML subset that doesn't require a full parser.
 * We extract current-context and the matching context entry.
 */
function parseKubeconfig(content: string): KubeConfig {
  const result: {
    "current-context"?: string;
    contexts?: {
      name: string;
      context?: {
        cluster?: string;
        user?: string;
        namespace?: string;
      };
    }[];
  } = {};

  const lines = content.split("\n");
  let inContexts = false;
  let currentContextEntry: {
    name: string;
    context?: { cluster?: string; user?: string; namespace?: string };
  } | null = null;
  let inContextBlock = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Top-level current-context
    if (trimmed.startsWith("current-context:")) {
      const value = trimmed.slice("current-context:".length).trim();
      // Strip optional quotes
      result["current-context"] = value.replace(/^["']|["']$/g, "");
      continue;
    }

    // Detect top-level contexts: list
    if (trimmed === "contexts:") {
      inContexts = true;
      result.contexts = [];
      continue;
    }

    // Detect other top-level keys ending the contexts block
    if (inContexts && /^\S/.test(trimmed) && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
      // Save pending entry
      if (currentContextEntry) {
        result.contexts!.push(currentContextEntry);
        currentContextEntry = null;
      }
      inContexts = false;
      inContextBlock = false;
      continue;
    }

    if (!inContexts) continue;

    // New list item in contexts
    if (trimmed.startsWith("- ")) {
      if (currentContextEntry) {
        result.contexts!.push(currentContextEntry);
      }
      // "- name: xxx" form
      const nameMatch = trimmed.match(/^-\s+name:\s*(.+)/);
      currentContextEntry = { name: nameMatch ? nameMatch[1]!.replace(/^["']|["']$/g, "") : "" };
      inContextBlock = false;
      continue;
    }

    if (!currentContextEntry) continue;

    // "  name: xxx" on its own line
    const nameLineMatch = trimmed.match(/^\s+name:\s*(.+)/);
    if (nameLineMatch && !inContextBlock) {
      currentContextEntry.name = nameLineMatch[1]!.replace(/^["']|["']$/g, "");
      continue;
    }

    // "  context:" sub-block
    if (/^\s+context:/.test(trimmed)) {
      inContextBlock = true;
      currentContextEntry.context = {};
      continue;
    }

    // Properties inside context block
    if (inContextBlock && currentContextEntry.context) {
      const clusterMatch = trimmed.match(/^\s+cluster:\s*(.+)/);
      if (clusterMatch) {
        currentContextEntry.context.cluster = clusterMatch[1]!.replace(/^["']|["']$/g, "");
        continue;
      }
      const userMatch = trimmed.match(/^\s+user:\s*(.+)/);
      if (userMatch) {
        currentContextEntry.context.user = userMatch[1]!.replace(/^["']|["']$/g, "");
        continue;
      }
      const nsMatch = trimmed.match(/^\s+namespace:\s*(.+)/);
      if (nsMatch) {
        currentContextEntry.context.namespace = nsMatch[1]!.replace(/^["']|["']$/g, "");
        continue;
      }
    }
  }

  // Flush last entry
  if (currentContextEntry && inContexts) {
    result.contexts!.push(currentContextEntry);
  }

  return result;
}

function resolveKubeconfigPaths(): readonly string[] {
  const envPath = process.env.KUBECONFIG;
  if (envPath) {
    // KUBECONFIG can be colon-separated (or semicolon on Windows)
    const sep = process.platform === "win32" ? ";" : ":";
    return envPath.split(sep).filter((p) => p.length > 0);
  }
  return [NodePath.join(OS.homedir(), ".kube", "config")];
}

export const sampleKubecontext: Effect.Effect<RawSample["kubecontext"]> = Effect.tryPromise({
  try: async () => {
    const fs = await import("node:fs/promises");
    const paths = resolveKubeconfigPaths();

    for (const configPath of paths) {
      let content: string;
      try {
        content = await fs.readFile(configPath, "utf-8");
      } catch {
        continue;
      }

      const config = parseKubeconfig(content);
      const currentContext = config["current-context"];
      if (!currentContext) continue;

      const entry = config.contexts?.find((c) => c.name === currentContext);
      return {
        context: currentContext,
        cluster: entry?.context?.cluster ?? currentContext,
        namespace: entry?.context?.namespace ?? "default",
      };
    }

    return null;
  },
  catch: () => null,
}).pipe(Effect.orElseSucceed(() => null));
