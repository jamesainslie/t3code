import { create } from "zustand";

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

const MAX_ENTRIES = 500;

interface ConnectionLogState {
  readonly entries: ReadonlyArray<ConnectionLogEntry>;
  readonly append: (entry: ConnectionLogEntry) => void;
  readonly clear: () => void;
  readonly reset: () => void;
}

export const useConnectionLogStore = create<ConnectionLogState>()((set) => ({
  entries: [],
  append: (entry) =>
    set((state) => {
      const next = [entry, ...state.entries];
      if (next.length > MAX_ENTRIES) {
        next.length = MAX_ENTRIES;
      }
      return { entries: next };
    }),
  clear: () => set({ entries: [] }),
  reset: () => set({ entries: [] }),
}));

let idCounter = 0;

/**
 * Append a structured log entry to the connection log ring buffer.
 */
export function connectionLog(input: {
  readonly level: ConnectionLogEntry["level"];
  readonly source: string;
  readonly identityKey?: string | null;
  readonly label?: string | null;
  readonly message: string;
  readonly detail?: unknown;
}): void {
  idCounter += 1;
  const entry: ConnectionLogEntry = {
    id: `clog-${Date.now()}-${idCounter}`,
    timestamp: new Date().toISOString(),
    level: input.level,
    source: input.source,
    identityKey: input.identityKey ?? null,
    label: input.label ?? null,
    message: input.message,
    detail: input.detail,
  };
  useConnectionLogStore.getState().append(entry);
}
