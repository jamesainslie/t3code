// Projects / workspace WS RPC handlers.

import { Effect, Schema, Stream } from "effect";
import { ProjectSearchEntriesError, ProjectWriteFileError, WS_METHODS } from "@t3tools/contracts";

import { observeRpcEffect, observeRpcStream } from "../../observability/RpcInstrumentation.ts";
import { WorkspacePathOutsideRootError } from "../../workspace/Services/WorkspacePaths.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import type { HandlerDeps } from "./shared.ts";

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

function isMarkdownPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function projectsHandlers(deps: HandlerDeps) {
  const { workspaceEntries, workspaceFileSystem, fileDocs } = deps;

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
          Effect.tap(() =>
            isMarkdownPath(input.relativePath)
              ? fileDocs.recordTurnWrite({
                  cwd: input.cwd,
                  relativePath: input.relativePath,
                })
              : Effect.void,
          ),
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
    [WS_METHODS.projectsReadFile]: (input) =>
      observeRpcEffect(WS_METHODS.projectsReadFile, fileDocs.readFile(input), {
        "rpc.aggregate": "workspace",
      }),
    [WS_METHODS.projectsUpdateFrontmatter]: (input) =>
      observeRpcEffect(WS_METHODS.projectsUpdateFrontmatter, fileDocs.updateFrontmatter(input), {
        "rpc.aggregate": "workspace",
      }),
    [WS_METHODS.subscribeProjectFileChanges]: (input) =>
      observeRpcStream(WS_METHODS.subscribeProjectFileChanges, fileDocs.watch(input), {
        "rpc.aggregate": "workspace",
      }),
  } satisfies WsMethodRegistry;
}

// Keep Stream import in scope so the stream RPC signature resolves even when
// the referenced export is only used via `observeRpcStream`.
void Stream;
