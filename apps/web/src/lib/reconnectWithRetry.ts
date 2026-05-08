import type { EnvironmentId } from "@t3tools/contracts";
import {
  classifyConnectionError,
  getRetryConfig,
} from "./connectionErrorClassifier";
import { toastManager } from "~/components/ui/toast";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function reconnectWithRetry(input: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isSsh: boolean;
  readonly reconnect: () => Promise<void>;
  readonly setConnecting: () => void;
  readonly setError: (error: unknown) => void;
}): Promise<boolean> {
  const { label, isSsh, reconnect, setConnecting, setError } = input;

  let lastError: unknown;

  // First attempt
  try {
    setConnecting();
    await reconnect();
    return true;
  } catch (error) {
    lastError = error;
  }

  // Classify and determine retry strategy
  const classified = classifyConnectionError(lastError, { isSsh });
  const retryConfig = getRetryConfig(classified.category);

  if (!retryConfig) {
    setError(lastError);
    return false;
  }

  // Retry loop
  for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
    await sleep(retryConfig.delaysMs[attempt] ?? retryConfig.delaysMs.at(-1)!);
    try {
      setConnecting();
      await reconnect();
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  // All retries exhausted
  setError(lastError);
  toastManager.add({
    type: "error",
    title: `Connection to ${label} lost`,
    description: "Click to reconnect.",
  });
  return false;
}
