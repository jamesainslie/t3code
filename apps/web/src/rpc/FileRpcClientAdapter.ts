import type { RpcClient } from "@t3tools/mdreview-host";

import type { WsRpcClient } from "./wsRpcClient";

/**
 * Maps method strings used by {@link T3FileAdapter} to the corresponding
 * {@link WsRpcClient} operations. The adapter translates the generic
 * `call`/`stream` surface expected by mdreview-host into concrete typed
 * RPC calls on the websocket client.
 */
export function createFileRpcClientAdapter(wsRpcClient: WsRpcClient): RpcClient {
  return {
    call: async <_I = unknown, O = unknown>(method: string, input: unknown): Promise<O> => {
      switch (method) {
        case "projects.readFile":
          return (await wsRpcClient.projects.readFile(input as any)) as O;
        case "projects.writeFile":
          return (await wsRpcClient.projects.writeFile(input as any)) as O;
        case "projects.updateFrontmatter":
          return (await wsRpcClient.projects.updateFrontmatter(input as any)) as O;
        default:
          throw new Error(`FileRpcClientAdapter: unknown call method "${method}"`);
      }
    },
    stream: <_I = unknown, O = unknown>(
      method: string,
      input: unknown,
      handler: (event: O) => void,
    ): (() => void) => {
      switch (method) {
        case "subscribeProjectFileChanges":
          return wsRpcClient.projects.onFileChanges(input as any, handler as any);
        default:
          throw new Error(`FileRpcClientAdapter: unknown stream method "${method}"`);
      }
    },
  };
}
