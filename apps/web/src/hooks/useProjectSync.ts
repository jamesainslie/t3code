import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId, ProjectSyncRequest, ProjectSyncResponse } from "@t3tools/contracts";
import { executeProjectSync } from "@t3tools/client-runtime/state/project-sync";
import * as Option from "effect/Option";
import { runtime } from "../lib/runtime";
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
  const run = useCallback(
    async (request: ProjectSyncRequest) => {
      const current = generation.current;
      if (busy.current === current) throw new Error("A sync request is already in progress.");
      busy.current = current;
      setPending(true);
      setError(null);
      try {
        if (!prepared) throw new Error("Connect to this environment before managing sync.");
        const response = await runtime.runPromise(executeProjectSync(prepared, request));
        if (current !== generation.current)
          throw new Error(
            "The environment changed while the request was running. Refresh sync status.",
          );
        setResult({ environmentId, value: response });
        return response;
      } catch (cause) {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        if (current === generation.current) {
          busy.current = null;
          setPending(false);
        }
      }
    },
    [environmentId, prepared],
  );
  useEffect(() => {
    generation.current += 1;
    if (prepared) void run({ operation: "status" }).catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [prepared, run]);
  return {
    data: result?.environmentId === environmentId ? result.value : null,
    error,
    pending,
    run,
  };
}
