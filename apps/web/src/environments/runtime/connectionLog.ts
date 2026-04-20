import { create } from "zustand";

const MAX_LOG_ENTRIES = 500;

export interface ConnectionLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly source: string;
  readonly identityKey: string | null;
  readonly label: string | null;
  readonly message: string;
  readonly detail?: unknown;
}

interface ConnectionLogStore {
  readonly entries: ReadonlyArray<ConnectionLogEntry>;
  readonly push: (entry: Omit<ConnectionLogEntry, "id" | "timestamp">) => void;
  readonly clear: () => void;
}

let counter = 0;

export const useConnectionLogStore = create<ConnectionLogStore>()((set) => ({
  entries: [],
  push: (entry) =>
    set((state) => {
      const newEntry: ConnectionLogEntry = {
        ...entry,
        id: String(++counter),
        timestamp: new Date().toISOString(),
      };
      const next = [...state.entries, newEntry];
      if (next.length > MAX_LOG_ENTRIES) {
        return { entries: next.slice(next.length - MAX_LOG_ENTRIES) };
      }
      return { entries: next };
    }),
  clear: () => set({ entries: [] }),
}));

/**
 * Push a connection lifecycle log entry. Convenience wrapper around the store.
 */
export function connectionLog(
  level: "info" | "warn" | "error",
  source: string,
  message: string,
  opts?: { identityKey?: string; label?: string; detail?: unknown },
): void {
  useConnectionLogStore.getState().push({
    level,
    source,
    identityKey: opts?.identityKey ?? null,
    label: opts?.label ?? null,
    message,
    ...(opts?.detail !== undefined ? { detail: opts.detail } : {}),
  });
}

/** @internal Exported for testing only. */
export function resetConnectionLogForTests(): void {
  counter = 0;
  useConnectionLogStore.setState({ entries: [] });
}
