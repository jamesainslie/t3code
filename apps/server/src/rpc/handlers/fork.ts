// Fork-specific WS RPC handlers. Upstream should never touch this file.
//
// Any fork-only RPC method must live here, not in `ws.ts` or any upstream
// handler file. The file exists solely so that upstream merges do not collide
// with fork-added handlers.

import { Effect, Option } from "effect";
import { WS_METHODS } from "@t3tools/contracts";

import { observeRpcStreamEffect } from "../../observability/RpcInstrumentation.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import type { HandlerDeps } from "./shared.ts";

export function forkHandlers(deps: HandlerDeps) {
  const { projectionSnapshotQuery, hostResourceMonitor } = deps;

  return {
    [WS_METHODS.subscribeHostResources]: (input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeHostResources,
        Effect.gen(function* () {
          const shellOption = yield* projectionSnapshotQuery
            .getProjectShellById(input.projectId)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          const workspacePath = Option.match(shellOption, {
            onNone: () => "",
            onSome: (shell) => shell.workspaceRoot,
          });
          return hostResourceMonitor.subscribe(workspacePath);
        }),
        { "rpc.aggregate": "hostResource" },
      ),
  } satisfies WsMethodRegistry;
}
