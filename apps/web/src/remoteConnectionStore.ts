import { create } from "zustand";
import type { DesktopSshProvisioningEvent, RemoteConnectionStatus } from "@t3tools/contracts";

export interface ProvisionPhaseState {
  phase: number;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  logs: string[];
}

interface RemoteConnectionEntry {
  projectId: string;
  status: RemoteConnectionStatus;
  wsUrl?: string;
  error?: string;
  /** Granular provisioning phase from the SSH manager (e.g. "connecting", "installing binary"). */
  phase?: string;
  /** Granular provisioning events for the timeline UI */
  provisionPhases: ProvisionPhaseState[];
  /** Most recent provisioning error message */
  provisionError?: string;
}

interface RemoteConnectionStore {
  connections: Record<string, RemoteConnectionEntry>;
  setStatus(
    projectId: string,
    status: RemoteConnectionStatus,
    extra?: Partial<Pick<RemoteConnectionEntry, "wsUrl" | "error">>,
  ): void;
  setPhase(projectId: string, phase: string): void;
  addProvisionEvent(projectId: string, event: DesktopSshProvisioningEvent): void;
  resetProvisionPhases(projectId: string): void;
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
          provisionPhases: [],
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

  addProvisionEvent(projectId, event) {
    set((state) => {
      const existing = state.connections[projectId];
      if (!existing) return state;

      const phases = [...(existing.provisionPhases ?? [])];

      if (event.type === "phase-start" && event.phase != null && event.label) {
        // Mark any currently active phase as complete (defensive — normally phase-complete fires)
        for (const p of phases) {
          if (p.status === "active") p.status = "complete";
        }
        // Find or create the phase slot
        const idx = phases.findIndex((p) => p.phase === event.phase);
        const found = idx >= 0 ? phases[idx] : undefined;
        if (found) {
          phases[idx] = { phase: found.phase, label: event.label, status: "active", logs: [] };
        } else {
          phases.push({ phase: event.phase, label: event.label, status: "active", logs: [] });
        }
      } else if (event.type === "phase-complete" && event.phase != null) {
        const idx = phases.findIndex((p) => p.phase === event.phase);
        const found = idx >= 0 ? phases[idx] : undefined;
        if (found) {
          phases[idx] = { phase: found.phase, label: found.label, status: "complete", logs: found.logs };
        }
      } else if (event.type === "log" && event.phase != null && event.message) {
        const idx = phases.findIndex((p) => p.phase === event.phase);
        const found = idx >= 0 ? phases[idx] : undefined;
        if (found) {
          phases[idx] = { phase: found.phase, label: found.label, status: found.status, logs: [...found.logs, event.message] };
        }
      } else if (event.type === "error") {
        if (event.phase != null) {
          const idx = phases.findIndex((p) => p.phase === event.phase);
          const found = idx >= 0 ? phases[idx] : undefined;
          if (found) {
            phases[idx] = { phase: found.phase, label: found.label, status: "error", logs: found.logs };
          }
        }
        const updated: RemoteConnectionEntry = {
          ...existing,
          provisionPhases: phases,
        };
        if (event.message) {
          updated.provisionError = event.message;
        }
        return {
          connections: {
            ...state.connections,
            [projectId]: updated,
          },
        };
      }

      return {
        connections: {
          ...state.connections,
          [projectId]: { ...existing, provisionPhases: phases },
        },
      };
    });
  },

  resetProvisionPhases(projectId) {
    set((state) => {
      const existing = state.connections[projectId];
      if (!existing) return state;
      // Create a clean copy without provisionError (delete instead of setting undefined)
      const { provisionError: _, ...rest } = existing;
      return {
        connections: {
          ...state.connections,
          [projectId]: {
            ...rest,
            provisionPhases: [],
          },
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
