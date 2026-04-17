// Terminal WS RPC handlers.

import { Effect, Queue, Stream } from "effect";
import { type TerminalEvent, WS_METHODS } from "@t3tools/contracts";

import { observeRpcEffect, observeRpcStream } from "../../observability/RpcInstrumentation.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import type { HandlerDeps } from "./shared.ts";

export function terminalHandlers(deps: HandlerDeps) {
  const { terminalManager } = deps;

  return {
    [WS_METHODS.terminalOpen]: (input) =>
      observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.terminalWrite]: (input) =>
      observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.terminalResize]: (input) =>
      observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.terminalClear]: (input) =>
      observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.terminalRestart]: (input) =>
      observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.terminalClose]: (input) =>
      observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
        "rpc.aggregate": "terminal",
      }),
    [WS_METHODS.subscribeTerminalEvents]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeTerminalEvents,
        Stream.callback<TerminalEvent>((queue) =>
          Effect.acquireRelease(
            terminalManager.subscribe((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
        { "rpc.aggregate": "terminal" },
      ),
  } satisfies WsMethodRegistry;
}
