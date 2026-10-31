import { useEffect, useRef, useState } from "react";
import type { EnvironmentId, ProjectSyncRequest, ProjectSyncResponse } from "@lathe/contracts";
import { executeProjectSync } from "@lathe/client-runtime/state/project-sync";
import * as Option from "effect/Option";
import { runtime } from "../lib/runtime";
import { useStableCallback } from "./useStableCallback";
import { usePreparedConnection } from "../state/session";

export function useProjectSync(environmentId: EnvironmentId) {
  const prepared = Option.getOrNull(usePreparedConnection(environmentId));
  const [result, setResult] = useState<{
    environmentId: EnvironmentId;
    value: ProjectSyncResponse;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const busy = useRef<number | null>(null);
  const run = async (request: ProjectSyncRequest) => {
    const current = generation.current;
    if (busy.current === current) throw new Error("A sync request is already in progress.");
    busy.current = current;
    setPending(true);
    setError(null);
    const settle = () => {
      busy.current = null;
      setPending(false);
    };
    // No try/finally: the React Compiler skips a hook that uses one.
    const fail = (cause: unknown): never => {
      if (current === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        settle();
      }
      throw cause;
    };
    if (!prepared) return fail(new Error("Connect to this environment before managing sync."));
    const response = await runtime.runPromise(executeProjectSync(prepared, request)).catch(fail);
    if (current !== generation.current)
      throw new Error(
        "The environment changed while the request was running. Refresh sync status.",
      );
    setResult({ environmentId, value: response });
    settle();
    return response;
  };
  // Stable, so the status request reruns only when the connection changes.
  const runStable = useStableCallback(run);
  // oxlint-disable-next-line lathe/no-unreasoned-state-sync -- requests sync status when the connection changes and invalidates responses from the old one
  useEffect(() => {
    generation.current += 1;
    if (prepared) void runStable({ operation: "status" }).catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [prepared, runStable]);
  return {
    data: result?.environmentId === environmentId ? result.value : null,
    error,
    pending,
    run,
  };
}
