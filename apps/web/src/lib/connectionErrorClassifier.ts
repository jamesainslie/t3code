export type ConnectionErrorCategory =
  | "tunnel-closed"
  | "auth-expired"
  | "server-unreachable"
  | "network-error";

export interface ClassifiedConnectionError {
  readonly category: ConnectionErrorCategory;
  readonly headline: string;
  readonly guidance: string;
}

const CLASSIFICATIONS: Record<
  ConnectionErrorCategory,
  Omit<ClassifiedConnectionError, "category">
> = {
  "tunnel-closed": {
    headline: "Connection lost",
    guidance: "Reconnect will re-establish the SSH tunnel.",
  },
  "auth-expired": {
    headline: "Session expired",
    guidance: "Re-pair this environment from the remote host.",
  },
  "server-unreachable": {
    headline: "Server unreachable",
    guidance: "Start the t3 server on the remote host.",
  },
  "network-error": {
    headline: "Network error",
    guidance: "Check that the host is online and reachable.",
  },
};

function getStatusCode(error: unknown): number | null {
  if (
    error !== null &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return null;
}

function isFetchTypeError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.cause instanceof TypeError) return true;
  if (
    error instanceof Error &&
    error.message.includes("Failed to fetch remote auth endpoint") &&
    error.message.includes("Failed to fetch")
  ) {
    return true;
  }
  return false;
}

export function classifyConnectionError(
  error: unknown,
  context: { readonly isSsh: boolean },
): ClassifiedConnectionError {
  const statusCode = getStatusCode(error);

  // HTTP 401/403 → auth expired (regardless of SSH)
  if (statusCode === 401 || statusCode === 403) {
    return { category: "auth-expired", ...CLASSIFICATIONS["auth-expired"] };
  }

  // HTTP 502/503/504 → server unreachable
  if (statusCode !== null && statusCode >= 502 && statusCode <= 504) {
    return { category: "server-unreachable", ...CLASSIFICATIONS["server-unreachable"] };
  }

  // Fetch TypeError → tunnel-closed (SSH) or server-unreachable (non-SSH)
  if (isFetchTypeError(error)) {
    if (context.isSsh) {
      return { category: "tunnel-closed", ...CLASSIFICATIONS["tunnel-closed"] };
    }
    // For non-SSH, check for DNS/timeout patterns → network-error
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("ERR_NAME_NOT_RESOLVED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT")
    ) {
      return { category: "network-error", ...CLASSIFICATIONS["network-error"] };
    }
    return { category: "server-unreachable", ...CLASSIFICATIONS["server-unreachable"] };
  }

  // Fallback
  return { category: "network-error", ...CLASSIFICATIONS["network-error"] };
}

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly delaysMs: readonly number[];
}

export function getRetryConfig(category: ConnectionErrorCategory): RetryConfig | null {
  switch (category) {
    case "tunnel-closed":
      return { maxAttempts: 3, delaysMs: [2000, 4000, 8000] };
    case "server-unreachable":
    case "network-error":
      return { maxAttempts: 2, delaysMs: [5000, 10000] };
    case "auth-expired":
      return null;
  }
}
