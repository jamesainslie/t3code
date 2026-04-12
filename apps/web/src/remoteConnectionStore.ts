import { create } from "zustand";
import type { RemoteConnectionStatus } from "@t3tools/contracts";

interface RemoteConnectionEntry {
  projectId: string;
  status: RemoteConnectionStatus;
  wsUrl?: string;
  error?: string;
  /** Granular provisioning phase from the SSH manager (e.g. "connecting", "installing binary"). */
  phase?: string;
}

interface RemoteConnectionStore {
  connections: Record<string, RemoteConnectionEntry>;
  setStatus(
    projectId: string,
    status: RemoteConnectionStatus,
    extra?: Partial<Pick<RemoteConnectionEntry, "wsUrl" | "error">>,
  ): void;
  setPhase(projectId: string, phase: string): void;
  getStatus(projectId: string): RemoteConnectionStatus;
  getEntry(projectId: string): RemoteConnectionEntry | undefined;
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

  setPhase(projectId, phase) {
    set((state) => {
      const existing = state.connections[projectId];
      if (!existing) return state;
      return {
        connections: {
          ...state.connections,
          [projectId]: { ...existing, phase },
        },
      };
    });
  },

  getStatus(projectId) {
    return get().connections[projectId]?.status ?? "disconnected";
  },

  getEntry(projectId) {
    return get().connections[projectId];
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
