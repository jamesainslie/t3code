// Projects / workspace WS RPC handlers.

import { Effect, Schema } from "effect";
import { ProjectSearchEntriesError, ProjectWriteFileError, WS_METHODS } from "@t3tools/contracts";

import { observeRpcEffect } from "../../observability/RpcInstrumentation.ts";
import { WorkspacePathOutsideRootError } from "../../workspace/Services/WorkspacePaths.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import type { HandlerDeps } from "./shared.ts";

export function projectsHandlers(deps: HandlerDeps) {
  const { workspaceEntries, workspaceFileSystem } = deps;

  return {
    [WS_METHODS.projectsSearchEntries]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsSearchEntries,
        workspaceEntries.search(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSearchEntriesError({
                message: `Failed to search workspace entries: ${cause.detail}`,
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.projectsWriteFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsWriteFile,
        workspaceFileSystem.writeFile(input).pipe(
          Effect.mapError((cause) => {
            const message = Schema.is(WorkspacePathOutsideRootError)(cause)
              ? "Workspace file path must stay within the project root."
              : "Failed to write workspace file";
            return new ProjectWriteFileError({
              message,
              cause,
            });
          }),
        ),
        { "rpc.aggregate": "workspace" },
      ),
  } satisfies WsMethodRegistry;
}
