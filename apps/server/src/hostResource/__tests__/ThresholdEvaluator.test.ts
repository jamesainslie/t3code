import { describe, expect, it } from "vitest";
import { ResourceThresholds, KubeDangerPatterns } from "@t3tools/contracts";
import type { RawSample } from "../Services/ResourceSampler.ts";
import type { EvaluatorState } from "../Services/ThresholdEvaluator.ts";
import { evaluateThresholds, makeInitialState } from "../Layers/ThresholdEvaluator.ts";

// ─── Helpers ───────────────────────────────────────────────────────

const thresholds = ResourceThresholds;
const dangerPatterns = KubeDangerPatterns;
const sampleIntervalSeconds = 5;

function baseSample(overrides: Partial<RawSample> = {}): RawSample {
  return {
    ram: {
      totalBytes: 16_000_000_000,
      usedBytes: 8_000_000_000,
      availableBytes: 8_000_000_000,
      usagePercent: 50,
      swapUsedBytes: 0,
      swapTotalBytes: 4_000_000_000,
    },
    cpu: {
      usagePercent: 30,
      coreCount: 8,
    },
    disk: {
      totalBytes: 500_000_000_000,
      usedBytes: 250_000_000_000,
      availableBytes: 250_000_000_000,
      usagePercent: 50,
      mountPath: "/",
    },
    containers: {
      running: 5,
      stopped: 2,
      total: 7,
    },
    kubecontext: {
      context: "dv-eastus-core",
      cluster: "dv-eastus-core",
      namespace: "default",
    },
    remote: {
      isRemote: false,
      hostname: "laptop",
      fqdn: "laptop.local",
      isRoot: false,
    },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("ThresholdEvaluator — evaluateThresholds", () => {
  describe("makeInitialState", () => {
    it("starts with all metrics normal and null tracking values", () => {
      const state = makeInitialState();
      expect(state.ram).toBe("normal");
      expect(state.cpu).toBe("normal");
      expect(state.disk).toBe("normal");
      expect(state.containers).toBe("normal");
      expect(state.kubecontext).toBe("normal");
      expect(state.remote).toBe("normal");
      expect(state.lastContainerCount).toBeNull();
      expect(state.lastKubecontext).toBeNull();
      expect(state.lastIsRemote).toBe(false);
      expect(state.lastIsRoot).toBe(false);
      expect(state.cpuSamples).toEqual([]);
    });
  });

  describe("RAM thresholds", () => {
    it("stays normal when below warn threshold", () => {
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 50,
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("normal");
      expect(result.nextState.ram).toBe("normal");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(0);
    });

    it("transitions normal->warn when crossing warn threshold", () => {
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 82,
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("warn");
      expect(result.nextState.ram).toBe("warn");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(1);
      expect(ramTransitions[0]).toEqual({
        metric: "ram",
        previousState: "normal",
        currentState: "warn",
      });
    });

    it("transitions warn->critical when crossing critical threshold", () => {
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 93,
        },
      });
      const state: EvaluatorState = { ...makeInitialState(), ram: "warn" };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("critical");
      expect(result.nextState.ram).toBe("critical");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(1);
      expect(ramTransitions[0]).toEqual({
        metric: "ram",
        previousState: "warn",
        currentState: "critical",
      });
    });

    it("stays in warn state due to hysteresis (76% with warn=80)", () => {
      // 76% is above 80-5=75, so hysteresis keeps it in warn
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 76,
        },
      });
      const state: EvaluatorState = { ...makeInitialState(), ram: "warn" };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("warn");
      expect(result.nextState.ram).toBe("warn");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(0);
    });

    it("transitions warn->normal when dropping below hysteresis band", () => {
      // 74% is below 80-5=75, so it transitions back to normal
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 74,
        },
      });
      const state: EvaluatorState = { ...makeInitialState(), ram: "warn" };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("normal");
      expect(result.nextState.ram).toBe("normal");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(1);
      expect(ramTransitions[0]).toEqual({
        metric: "ram",
        previousState: "warn",
        currentState: "normal",
      });
    });

    it("transitions critical->warn when dropping below critical hysteresis band", () => {
      // critical threshold = 92, hysteresis = 92-5 = 87
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 86,
        },
      });
      const state: EvaluatorState = { ...makeInitialState(), ram: "critical" };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.ram.state).toBe("warn");
      expect(result.nextState.ram).toBe("warn");
      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      expect(ramTransitions).toHaveLength(1);
      expect(ramTransitions[0]).toEqual({
        metric: "ram",
        previousState: "critical",
        currentState: "warn",
      });
    });
  });

  describe("CPU sustained detection", () => {
    it("does not trigger warn from a single spike when window > 1", () => {
      // With sustainedSeconds=5 and sampleInterval=1, window=5
      // Pre-fill window with 4 normal samples, then one spike at 90%
      // Average = (30+30+30+30+90)/5 = 42 -> normal
      const state: EvaluatorState = {
        ...makeInitialState(),
        cpuSamples: [30, 30, 30, 30],
      };
      const sample = baseSample({
        cpu: { usagePercent: 90, coreCount: 8 },
      });
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        1, // 1-second interval -> window of 5
      );

      expect(result.snapshot.cpu.state).toBe("normal");
      expect(result.nextState.cpu).toBe("normal");
    });

    it("triggers warn when sustained average crosses threshold", () => {
      // With sustainedSeconds=5 and sampleInterval=1, window=5
      // Fill 5 samples all at 90% -> average = 90 -> exceeds warn=85
      const state: EvaluatorState = {
        ...makeInitialState(),
        cpuSamples: [90, 90, 90, 90],
      };
      const sample = baseSample({
        cpu: { usagePercent: 90, coreCount: 8 },
      });
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        1, // 1-second interval -> window of 5
      );

      expect(result.snapshot.cpu.state).toBe("warn");
      expect(result.nextState.cpu).toBe("warn");
      expect(result.snapshot.cpu.sustainedPercent).toBe(90);
    });

    it("uses default interval (5s) to compute window of 1 (immediate)", () => {
      // sustainedSeconds=5, sampleInterval=5 -> window=1
      // A single sample of 90% averages to 90 -> exceeds warn=85
      const sample = baseSample({
        cpu: { usagePercent: 90, coreCount: 8 },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(sample, state, thresholds, dangerPatterns, 5);

      expect(result.snapshot.cpu.state).toBe("warn");
      expect(result.nextState.cpu).toBe("warn");
    });
  });

  describe("Kubecontext danger detection", () => {
    it("detects danger when context matches a danger pattern", () => {
      const sample = baseSample({
        kubecontext: {
          context: "pd-eastus-core",
          cluster: "pd-eastus-core",
          namespace: "default",
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.kubecontext).not.toBeNull();
      expect(result.snapshot.kubecontext!.state).toBe("critical");
      expect(result.snapshot.kubecontext!.isDanger).toBe(true);
      expect(result.snapshot.kubecontext!.dangerReason).toContain("pd-");
    });

    it("stays normal when context does not match danger patterns", () => {
      const sample = baseSample({
        kubecontext: {
          context: "dv-eastus-core",
          cluster: "dv-eastus-core",
          namespace: "default",
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.kubecontext).not.toBeNull();
      expect(result.snapshot.kubecontext!.state).toBe("normal");
      expect(result.snapshot.kubecontext!.isDanger).toBe(false);
      expect(result.snapshot.kubecontext!.dangerReason).toBeNull();
    });

    it("emits transition when kube context changes to danger", () => {
      const sample = baseSample({
        kubecontext: {
          context: "pd-eastus-core",
          cluster: "pd-eastus-core",
          namespace: "default",
        },
      });
      const state: EvaluatorState = {
        ...makeInitialState(),
        lastKubecontext: "dv-eastus-core",
      };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const kubeTransitions = result.transitions.filter((t) => t.metric === "kubecontext");
      expect(kubeTransitions).toHaveLength(1);
      expect(kubeTransitions[0]).toEqual({
        metric: "kubecontext",
        previousState: "normal",
        currentState: "critical",
      });
    });

    it("is case-insensitive for pattern matching", () => {
      const sample = baseSample({
        kubecontext: {
          context: "PD-EASTUS-CORE",
          cluster: "pd-eastus-core",
          namespace: "default",
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.kubecontext!.isDanger).toBe(true);
    });

    it("handles null kubecontext sample", () => {
      const sample = baseSample({ kubecontext: null });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.kubecontext).toBeNull();
    });
  });

  describe("Container count tracking", () => {
    it("emits transition when container count changes", () => {
      const sample = baseSample({
        containers: { running: 8, stopped: 2, total: 10 },
      });
      const state: EvaluatorState = {
        ...makeInitialState(),
        lastContainerCount: 7,
      };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const containerTransitions = result.transitions.filter((t) => t.metric === "containers");
      expect(containerTransitions).toHaveLength(1);
      expect(containerTransitions[0]).toEqual({
        metric: "containers",
        previousState: "normal",
        currentState: "normal",
      });
      expect(result.nextState.lastContainerCount).toBe(10);
    });

    it("does not emit transition when container count stays the same", () => {
      const sample = baseSample({
        containers: { running: 5, stopped: 2, total: 7 },
      });
      const state: EvaluatorState = {
        ...makeInitialState(),
        lastContainerCount: 7,
      };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const containerTransitions = result.transitions.filter((t) => t.metric === "containers");
      expect(containerTransitions).toHaveLength(0);
    });

    it("handles null containers sample", () => {
      const sample = baseSample({ containers: null });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.containers).toBeNull();
    });
  });

  describe("Remote / root detection", () => {
    it("emits critical transition when isRoot is true", () => {
      const sample = baseSample({
        remote: {
          isRemote: true,
          hostname: "server",
          fqdn: "server.example.com",
          isRoot: true,
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.nextState.remote).toBe("critical");
      const remoteTransitions = result.transitions.filter((t) => t.metric === "remote");
      expect(remoteTransitions.length).toBeGreaterThanOrEqual(1);
      // Should have a transition to critical for root
      expect(remoteTransitions.some((t) => t.currentState === "critical")).toBe(true);
    });

    it("emits transition when isRemote changes", () => {
      const sample = baseSample({
        remote: {
          isRemote: true,
          hostname: "server",
          fqdn: "server.example.com",
          isRoot: false,
        },
      });
      const state: EvaluatorState = {
        ...makeInitialState(),
        lastIsRemote: false,
      };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const remoteTransitions = result.transitions.filter((t) => t.metric === "remote");
      expect(remoteTransitions).toHaveLength(1);
      expect(result.nextState.lastIsRemote).toBe(true);
    });

    it("does not emit transition when remote state is unchanged", () => {
      const sample = baseSample({
        remote: {
          isRemote: false,
          hostname: "laptop",
          fqdn: "laptop.local",
          isRoot: false,
        },
      });
      const state: EvaluatorState = {
        ...makeInitialState(),
        lastIsRemote: false,
        lastIsRoot: false,
      };
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const remoteTransitions = result.transitions.filter((t) => t.metric === "remote");
      expect(remoteTransitions).toHaveLength(0);
    });
  });

  describe("Multiple transitions in one evaluation", () => {
    it("produces RAM warn + root critical in a single evaluation", () => {
      const sample = baseSample({
        ram: {
          ...baseSample().ram,
          usagePercent: 85,
        },
        remote: {
          isRemote: true,
          hostname: "server",
          fqdn: "server.example.com",
          isRoot: true,
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      const ramTransitions = result.transitions.filter((t) => t.metric === "ram");
      const remoteTransitions = result.transitions.filter((t) => t.metric === "remote");
      expect(ramTransitions).toHaveLength(1);
      expect(ramTransitions[0]!.currentState).toBe("warn");
      expect(remoteTransitions.length).toBeGreaterThanOrEqual(1);
      expect(remoteTransitions.some((t) => t.currentState === "critical")).toBe(true);
    });
  });

  describe("Disk thresholds", () => {
    it("transitions normal->warn at disk warn threshold", () => {
      const sample = baseSample({
        disk: {
          ...baseSample().disk,
          usagePercent: 87,
        },
      });
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      expect(result.snapshot.disk.state).toBe("warn");
      expect(result.nextState.disk).toBe("warn");
      const diskTransitions = result.transitions.filter((t) => t.metric === "disk");
      expect(diskTransitions).toHaveLength(1);
    });
  });

  describe("Snapshot output shape", () => {
    it("populates all snapshot fields correctly from the raw sample", () => {
      const sample = baseSample();
      const state = makeInitialState();
      const result = evaluateThresholds(
        sample,
        state,
        thresholds,
        dangerPatterns,
        sampleIntervalSeconds,
      );

      // RAM
      expect(result.snapshot.ram.usagePercent).toBe(50);
      expect(result.snapshot.ram.totalBytes).toBe(16_000_000_000);

      // CPU
      expect(result.snapshot.cpu.coreCount).toBe(8);

      // Disk
      expect(result.snapshot.disk.mountPath).toBe("/");

      // Containers
      expect(result.snapshot.containers).not.toBeNull();
      expect(result.snapshot.containers!.running).toBe(5);
      expect(result.snapshot.containers!.total).toBe(7);

      // Kubecontext
      expect(result.snapshot.kubecontext).not.toBeNull();
      expect(result.snapshot.kubecontext!.context).toBe("dv-eastus-core");

      // Remote
      expect(result.snapshot.remote.hostname).toBe("laptop");
    });
  });
});
