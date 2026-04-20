import { useEffect, useRef } from "react";
import type { EnvironmentId, ProjectFileChangeEvent } from "@t3tools/contracts";
import { readEnvironmentApi } from "../environmentApi";
import { toastManager } from "../components/ui/toast";

interface UseDocsChangeToastOptions {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  /** Currently open docsPath, if any. Events for this path are suppressed. */
  openDocsPath: string | null;
}

export function useDocsChangeToast(options: UseDocsChangeToastOptions): void {
  const { environmentId, cwd, openDocsPath } = options;
  const openPathRef = useRef(openDocsPath);
  openPathRef.current = openDocsPath;

  useEffect(() => {
    if (!environmentId || !cwd) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    return api.projectFiles.onFileChange(
      { cwd, globs: ["**/*.md"], ignoreGlobs: [] },
      (event: ProjectFileChangeEvent) => {
        if (event._tag !== "turnTouchedDoc") return;

        const relevantPaths = event.paths.filter((p) => p !== openPathRef.current);
        if (relevantPaths.length === 0) return;

        const label =
          relevantPaths.length === 1
            ? `${relevantPaths[0]} updated`
            : `${relevantPaths.length} docs updated`;

        toastManager.add({
          type: "info",
          title: label,
          data: {
            dismissAfterVisibleMs: 4000,
          },
        });
      },
    );
  }, [environmentId, cwd]);
}
