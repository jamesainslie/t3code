import { useEffect, useState } from "react";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

export interface FileContentsResult {
  readonly contents: string;
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FileContentsError {
  readonly tag: string;
  readonly relativePath: string;
}

export interface UseFileContentsResult {
  readonly data: FileContentsResult | null;
  readonly isLoading: boolean;
  readonly error: FileContentsError | null;
}

/**
 * Fetch file contents via the wsRpcClient readFile RPC. Re-fetches whenever
 * `relativePath` changes. Returns loading/error/data states.
 */
export function useFileContents(
  rpcClient: WsRpcClient | null,
  cwd: string | null,
  relativePath: string | null,
): UseFileContentsResult {
  const [data, setData] = useState<FileContentsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FileContentsError | null>(null);

  useEffect(() => {
    if (!rpcClient || !cwd || !relativePath) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    setIsLoading(true);
    setError(null);
    setData(null);

    rpcClient.projects
      .readFile({ cwd, relativePath })
      .then((result) => {
        if (cancelled) return;
        setData({
          contents: result.contents,
          relativePath: result.relativePath,
          size: result.size,
          mtimeMs: result.mtimeMs,
        });
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const parsed = parseReadFileError(err, relativePath);
        setError(parsed);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rpcClient, cwd, relativePath]);

  return { data, isLoading, error };
}

/**
 * Best-effort extraction of a tagged error from the RPC rejection.
 * The server uses Effect Schema tagged structs (NotFound, TooLarge, etc.).
 */
function parseReadFileError(err: unknown, fallbackPath: string): FileContentsError {
  if (err !== null && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record._tag === "string") {
      return {
        tag: record._tag,
        relativePath:
          typeof record.relativePath === "string" ? record.relativePath : fallbackPath,
      };
    }
  }
  return { tag: "Unknown", relativePath: fallbackPath };
}
