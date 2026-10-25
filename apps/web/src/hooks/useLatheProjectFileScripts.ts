import {
  LATHE_PROJECT_FILE_NAME,
  type EnvironmentId,
  type LatheProjectFile,
  type LatheProjectFileScript,
} from "@lathe/contracts";
import { parseLatheProjectFile } from "@lathe/shared/latheProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<LatheProjectFileScript> = [];

export interface LatheProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: LatheProjectFile | null;
  scripts: ReadonlyArray<LatheProjectFileScript>;
}

export function useLatheProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): LatheProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    LATHE_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseLatheProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useLatheProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<LatheProjectFileScript> {
  return useLatheProjectFileState(environmentId, cwd).scripts;
}
