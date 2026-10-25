import {
  LATHE_PROJECT_FILE_NAME,
  type EnvironmentId,
  type LatheProjectFile,
} from "@lathe/contracts";
import { parseLatheProjectFile } from "@lathe/shared/latheProjectFile";
import { executeAtomQuery } from "@lathe/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readLatheProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<LatheProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, LATHE_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    LATHE_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseLatheProjectFile(data.contents);
}
