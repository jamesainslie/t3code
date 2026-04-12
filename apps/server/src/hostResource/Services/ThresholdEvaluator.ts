import { Context } from "effect";
import type { Effect } from "effect";
import type { RawSample } from "./ResourceSampler.ts";
import type {
  MetricState,
  ResourceMetricKind,
  HostResourceSnapshot,
} from "@t3tools/contracts";

// ─── Evaluator State ───────────────────────────────────────────────

export interface EvaluatorState {
  readonly ram: MetricState;
  readonly cpu: MetricState;
  readonly disk: MetricState;
  readonly containers: MetricState;
  readonly kubecontext: MetricState;
  readonly remote: MetricState;
  readonly lastContainerCount: number | null;
  readonly lastKubecontext: string | null;
  readonly lastIsRemote: boolean;
  readonly lastIsRoot: boolean;
  readonly cpuSamples: readonly number[];
}

// ─── Transition ────────────────────────────────────────────────────

export interface Transition {
  readonly metric: ResourceMetricKind;
  readonly previousState: MetricState;
  readonly currentState: MetricState;
}

// ─── Evaluation Result ─────────────────────────────────────────────

export interface EvaluationResult {
  readonly snapshot: HostResourceSnapshot;
  readonly transitions: readonly Transition[];
  readonly nextState: EvaluatorState;
}

// ─── Service ───────────────────────────────────────────────────────

export interface ThresholdEvaluatorShape {
  /** Evaluate a raw sample against thresholds. Returns snapshot + any transitions. */
  readonly evaluate: (
    sample: RawSample,
    workspacePath: string,
  ) => Effect.Effect<EvaluationResult>;
}

export class ThresholdEvaluator extends Context.Service<
  ThresholdEvaluator,
  ThresholdEvaluatorShape
>()("t3/hostResource/Services/ThresholdEvaluator") {}
