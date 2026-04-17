import { describe, expect, it } from "vitest";
import { applyHostResourceStreamEvent, worstState } from "../hostResourceState";
import type { HostResourceSnapshot, HostResourceStreamEvent } from "@t3tools/contracts";

describe("hostResourceState", () => {
  describe("applyHostResourceStreamEvent", () => {
    it("sets full snapshot from snapshot event", () => {
      const snapshot = makeSnapshot("normal");
      const event: HostResourceStreamEvent = {
        version: 1,
        type: "snapshot",
        data: snapshot,
      };
      const result = applyHostResourceStreamEvent(null, event);
      expect(result).toEqual(snapshot);
    });

    it("replaces snapshot from transition event", () => {
      const initial = makeSnapshot("normal");
      const updated = {
        ...initial,
        ram: { ...initial.ram, state: "warn" as const, usagePercent: 85 },
      };
      const event: HostResourceStreamEvent = {
        version: 1,
        type: "transition",
        metric: "ram",
        previousState: "normal",
        currentState: "warn",
        data: updated,
      };
      const result = applyHostResourceStreamEvent(initial, event);
      expect(result!.ram.state).toBe("warn");
      expect(result!.ram.usagePercent).toBe(85);
    });
  });

  describe("worstState", () => {
    it("returns normal when all metrics normal", () => {
      expect(worstState(makeSnapshot("normal"))).toBe("normal");
    });

    it("returns warn when any metric is warn", () => {
      const base = makeSnapshot("normal");
      const s = { ...base, ram: { ...base.ram, state: "warn" as const } };
      expect(worstState(s)).toBe("warn");
    });

    it("returns critical when any metric is critical", () => {
      const base = makeSnapshot("normal");
      const s = { ...base, cpu: { ...base.cpu, state: "critical" as const } };
      expect(worstState(s)).toBe("critical");
    });

    it("returns critical when root user even if all metrics normal", () => {
      const base = makeSnapshot("normal");
      const s = { ...base, remote: { ...base.remote, isRoot: true } };
      expect(worstState(s)).toBe("critical");
    });

    it("critical takes priority over warn", () => {
      const base = makeSnapshot("normal");
      const s = {
        ...base,
        ram: { ...base.ram, state: "warn" as const },
        disk: { ...base.disk, state: "critical" as const },
      };
      expect(worstState(s)).toBe("critical");
    });
  });
});

function makeSnapshot(state: "normal" | "warn" | "critical"): HostResourceSnapshot {
  return {
    ram: {
      state,
      usagePercent: 50,
      totalBytes: 32e9,
      usedBytes: 16e9,
      availableBytes: 16e9,
      swapUsedBytes: 0,
      swapTotalBytes: 0,
    },
    cpu: { state, usagePercent: 10, coreCount: 10, sustainedPercent: 10 },
    disk: {
      state,
      usagePercent: 30,
      totalBytes: 1e12,
      usedBytes: 3e11,
      availableBytes: 7e11,
      mountPath: "/",
    },
    containers: null,
    kubecontext: null,
    remote: {
      isRemote: false,
      hostname: "test",
      fqdn: "test.local",
      isRoot: false,
    },
  };
}
