import { create } from "zustand";
import type { RemoteConnectionStatus } from "@t3tools/contracts";

interface RemoteConnectionEntry {
  projectId: string;
  status: RemoteConnectionStatus;
  wsUrl?: string;
  error?: string;
}

interface RemoteConnectionStore {
  connections: Record<string, RemoteConnectionEntry>;
  setStatus(
    projectId: string,
    status: RemoteConnectionStatus,
    extra?: Partial<Pick<RemoteConnectionEntry, "wsUrl" | "error">>,
  ): void;
  getStatus(projectId: string): RemoteConnectionStatus;
  getWsUrl(projectId: string): string | undefined;
  clearConnection(projectId: string): void;
}

export const useRemoteConnectionStore = create<RemoteConnectionStore>((set, get) => ({
  connections: {},

  setStatus(projectId, status, extra = {}) {
    set((state) => ({
      connections: {
        ...state.connections,
        [projectId]: {
          ...state.connections[projectId],
          projectId,
          status,
          ...extra,
        },
      },
    }));
  },

  getStatus(projectId) {
    return get().connections[projectId]?.status ?? "disconnected";
  },

  getWsUrl(projectId) {
    return get().connections[projectId]?.wsUrl;
  },

  clearConnection(projectId) {
    set((state) => {
      const next = { ...state.connections };
      delete next[projectId];
      return { connections: next };
    });
  },
}));
