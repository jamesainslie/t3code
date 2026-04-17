import { Effect, Layer, Ref } from "effect";
import {
  ResourceThresholds,
  KubeDangerPatterns,
  type MetricState,
  type HostResourceSnapshot,
} from "@t3tools/contracts";
import type { RawSample } from "../Services/ResourceSampler.ts";
import {
  ThresholdEvaluator,
  type EvaluatorState,
  type EvaluationResult,
  type Transition,
} from "../Services/ThresholdEvaluator.ts";

// ─── Constants ─────────────────────────────────────────────────────

const HYSTERESIS = 5;
const DEFAULT_SAMPLE_INTERVAL_SECONDS = 5;

// ─── Initial State ─────────────────────────────────────────────────

export function makeInitialState(): EvaluatorState {
  return {
    ram: "normal",
    cpu: "normal",
    disk: "normal",
    containers: "normal",
    kubecontext: "normal",
    remote: "normal",
    lastContainerCount: null,
    lastKubecontext: null,
    lastIsRemote: false,
    lastIsRoot: false,
    cpuSamples: [],
  };
}

// ─── Pure Threshold Logic ──────────────────────────────────────────

/**
 * Evaluate a percentage-based metric with hysteresis.
 * Returns the new MetricState given the current usage, previous state,
 * and the warn/critical thresholds.
 */
function evaluatePercentMetric(
  usagePercent: number,
  previousState: MetricState,
  warnThreshold: number,
  criticalThreshold: number,
): MetricState {
  switch (previousState) {
    case "normal":
      if (usagePercent >= criticalThreshold) return "critical";
      if (usagePercent >= warnThreshold) return "warn";
      return "normal";

    case "warn":
      if (usagePercent >= criticalThreshold) return "critical";
      if (usagePercent < warnThreshold - HYSTERESIS) return "normal";
      return "warn";

    case "critical":
      if (usagePercent < criticalThreshold - HYSTERESIS) {
        // Dropped below critical hysteresis — check if also below warn
        if (usagePercent < warnThreshold - HYSTERESIS) return "normal";
        return "warn";
      }
      return "critical";
  }
}

/**
 * Evaluate kube context against danger patterns.
 * Returns { state, isDanger, dangerReason }.
 */
function evaluateKubecontext(
  context: string,
  dangerPatterns: readonly string[],
): { state: MetricState; isDanger: boolean; dangerReason: string | null } {
  const lower = context.toLowerCase();
  for (const pattern of dangerPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return {
        state: "critical",
        isDanger: true,
        dangerReason: `Matches pattern: ${pattern}`,
      };
    }
  }
  return { state: "normal", isDanger: false, dangerReason: null };
}

// ─── Core Evaluator ────────────────────────────────────────────────

export function evaluateThresholds(
  sample: RawSample,
  state: EvaluatorState,
  thresholds: typeof ResourceThresholds,
  dangerPatterns: readonly string[],
  sampleIntervalSeconds: number = DEFAULT_SAMPLE_INTERVAL_SECONDS,
): EvaluationResult {
  const transitions: Transition[] = [];

  // ── RAM ──────────────────────────────────────────────────────────

  const ramState = evaluatePercentMetric(
    sample.ram.usagePercent,
    state.ram,
    thresholds.ram.warn,
    thresholds.ram.critical,
  );
  if (ramState !== state.ram) {
    transitions.push({
      metric: "ram",
      previousState: state.ram,
      currentState: ramState,
    });
  }

  // ── Disk ─────────────────────────────────────────────────────────

  const diskState = evaluatePercentMetric(
    sample.disk.usagePercent,
    state.disk,
    thresholds.disk.warn,
    thresholds.disk.critical,
  );
  if (diskState !== state.disk) {
    transitions.push({
      metric: "disk",
      previousState: state.disk,
      currentState: diskState,
    });
  }

  // ── CPU (sustained window) ───────────────────────────────────────

  const windowSize = Math.max(
    1,
    Math.round(thresholds.cpu.sustainedSeconds / sampleIntervalSeconds),
  );
  const newCpuSamples = [...state.cpuSamples, sample.cpu.usagePercent].slice(-windowSize);

  const sustainedPercent = newCpuSamples.reduce((sum, v) => sum + v, 0) / newCpuSamples.length;

  const cpuState = evaluatePercentMetric(
    sustainedPercent,
    state.cpu,
    thresholds.cpu.warn,
    thresholds.cpu.critical,
  );
  if (cpuState !== state.cpu) {
    transitions.push({
      metric: "cpu",
      previousState: state.cpu,
      currentState: cpuState,
    });
  }

  // ── Containers ───────────────────────────────────────────────────

  let containersSnapshot: HostResourceSnapshot["containers"] = null;
  let nextContainerCount = state.lastContainerCount;

  if (sample.containers !== null) {
    containersSnapshot = {
      state: "normal",
      running: sample.containers.running,
      stopped: sample.containers.stopped,
      total: sample.containers.total,
    };
    if (state.lastContainerCount !== null && sample.containers.total !== state.lastContainerCount) {
      transitions.push({
        metric: "containers",
        previousState: "normal",
        currentState: "normal",
      });
    }
    nextContainerCount = sample.containers.total;
  }

  // ── Kubecontext ──────────────────────────────────────────────────

  let kubecontextSnapshot: HostResourceSnapshot["kubecontext"] = null;
  let nextKubecontext = state.lastKubecontext;
  let nextKubecontextState: MetricState = state.kubecontext;

  if (sample.kubecontext !== null) {
    const kubeResult = evaluateKubecontext(sample.kubecontext.context, dangerPatterns);

    kubecontextSnapshot = {
      state: kubeResult.state,
      context: sample.kubecontext.context,
      cluster: sample.kubecontext.cluster,
      namespace: sample.kubecontext.namespace,
      isDanger: kubeResult.isDanger,
      dangerReason: kubeResult.dangerReason,
    };

    // Emit transition when context changes or danger state changes
    if (
      sample.kubecontext.context !== state.lastKubecontext ||
      kubeResult.state !== state.kubecontext
    ) {
      transitions.push({
        metric: "kubecontext",
        previousState: state.kubecontext,
        currentState: kubeResult.state,
      });
    }

    nextKubecontext = sample.kubecontext.context;
    nextKubecontextState = kubeResult.state;
  }

  // ── Remote ───────────────────────────────────────────────────────

  const remoteState: MetricState = sample.remote.isRoot ? "critical" : "normal";

  // Emit transition on isRemote change, isRoot change, or state change
  if (sample.remote.isRemote !== state.lastIsRemote || sample.remote.isRoot !== state.lastIsRoot) {
    transitions.push({
      metric: "remote",
      previousState: state.remote,
      currentState: remoteState,
    });
  }

  // ── Build Snapshot ───────────────────────────────────────────────

  const snapshot: HostResourceSnapshot = {
    ram: {
      state: ramState,
      usagePercent: sample.ram.usagePercent,
      totalBytes: sample.ram.totalBytes,
      usedBytes: sample.ram.usedBytes,
      availableBytes: sample.ram.availableBytes,
      swapUsedBytes: sample.ram.swapUsedBytes,
      swapTotalBytes: sample.ram.swapTotalBytes,
    },
    cpu: {
      state: cpuState,
      usagePercent: sample.cpu.usagePercent,
      coreCount: sample.cpu.coreCount,
      sustainedPercent: Math.round(sustainedPercent * 100) / 100,
    },
    disk: {
      state: diskState,
      usagePercent: sample.disk.usagePercent,
      totalBytes: sample.disk.totalBytes,
      usedBytes: sample.disk.usedBytes,
      availableBytes: sample.disk.availableBytes,
      mountPath: sample.disk.mountPath,
    },
    containers: containersSnapshot,
    kubecontext: kubecontextSnapshot,
    remote: {
      isRemote: sample.remote.isRemote,
      hostname: sample.remote.hostname,
      fqdn: sample.remote.fqdn,
      isRoot: sample.remote.isRoot,
    },
  };

  // ── Next State ───────────────────────────────────────────────────

  const nextState: EvaluatorState = {
    ram: ramState,
    cpu: cpuState,
    disk: diskState,
    containers: "normal",
    kubecontext: nextKubecontextState,
    remote: remoteState,
    lastContainerCount: nextContainerCount,
    lastKubecontext: nextKubecontext,
    lastIsRemote: sample.remote.isRemote,
    lastIsRoot: sample.remote.isRoot,
    cpuSamples: newCpuSamples,
  };

  return { snapshot, transitions, nextState };
}

// ─── Layer ─────────────────────────────────────────────────────────

export const ThresholdEvaluatorLive = Layer.effect(
  ThresholdEvaluator,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<EvaluatorState>(makeInitialState());
    const thresholds = ResourceThresholds;
    const dangerPatterns = KubeDangerPatterns;

    return {
      evaluate: (sample: RawSample, _workspacePath: string) =>
        Ref.modify(stateRef, (current) => {
          const result = evaluateThresholds(sample, current, thresholds, dangerPatterns);
          return [result, result.nextState] as const;
        }),
    };
  }),
);
