import { Schema } from "effect";
import { ProjectId } from "./baseSchemas";

// ─── Metric State & Kind ────────────────────────────────────────────

export const MetricState = Schema.Literals(["normal", "warn", "critical"]);
export type MetricState = typeof MetricState.Type;

export const ResourceMetricKind = Schema.Literals([
  "ram",
  "cpu",
  "disk",
  "containers",
  "kubecontext",
  "remote",
]);
export type ResourceMetricKind = typeof ResourceMetricKind.Type;

// ─── Per-metric Structs ─────────────────────────────────────────────

export const RamMetric = Schema.Struct({
  state: MetricState,
  usagePercent: Schema.Number,
  totalBytes: Schema.Number,
  usedBytes: Schema.Number,
  availableBytes: Schema.Number,
  swapUsedBytes: Schema.Number,
  swapTotalBytes: Schema.Number,
});
export type RamMetric = typeof RamMetric.Type;

export const CpuMetric = Schema.Struct({
  state: MetricState,
  usagePercent: Schema.Number,
  coreCount: Schema.Number,
  sustainedPercent: Schema.Number,
});
export type CpuMetric = typeof CpuMetric.Type;

export const DiskMetric = Schema.Struct({
  state: MetricState,
  usagePercent: Schema.Number,
  totalBytes: Schema.Number,
  usedBytes: Schema.Number,
  availableBytes: Schema.Number,
  mountPath: Schema.String,
});
export type DiskMetric = typeof DiskMetric.Type;

export const ContainersMetric = Schema.Struct({
  state: MetricState,
  running: Schema.Number,
  stopped: Schema.Number,
  total: Schema.Number,
});
export type ContainersMetric = typeof ContainersMetric.Type;

export const KubecontextMetric = Schema.Struct({
  state: MetricState,
  context: Schema.String,
  cluster: Schema.String,
  namespace: Schema.String,
  isDanger: Schema.Boolean,
  dangerReason: Schema.NullOr(Schema.String),
});
export type KubecontextMetric = typeof KubecontextMetric.Type;

export const RemoteMetric = Schema.Struct({
  isRemote: Schema.Boolean,
  hostname: Schema.String,
  fqdn: Schema.String,
  isRoot: Schema.Boolean,
});
export type RemoteMetric = typeof RemoteMetric.Type;

// ─── Snapshot ───────────────────────────────────────────────────────

export const HostResourceSnapshot = Schema.Struct({
  ram: RamMetric,
  cpu: CpuMetric,
  disk: DiskMetric,
  containers: Schema.NullOr(ContainersMetric),
  kubecontext: Schema.NullOr(KubecontextMetric),
  remote: RemoteMetric,
});
export type HostResourceSnapshot = typeof HostResourceSnapshot.Type;

// ─── Stream Events ──────────────────────────────────────────────────

export const HostResourceStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  data: HostResourceSnapshot,
});
export type HostResourceStreamSnapshotEvent = typeof HostResourceStreamSnapshotEvent.Type;

export const HostResourceStreamTransitionEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("transition"),
  metric: ResourceMetricKind,
  previousState: MetricState,
  currentState: MetricState,
  data: HostResourceSnapshot,
});
export type HostResourceStreamTransitionEvent = typeof HostResourceStreamTransitionEvent.Type;

export const HostResourceStreamEvent = Schema.Union([
  HostResourceStreamSnapshotEvent,
  HostResourceStreamTransitionEvent,
]);
export type HostResourceStreamEvent = typeof HostResourceStreamEvent.Type;

// ─── Subscription Input ─────────────────────────────────────────────

export const HostResourceSubscribeInput = Schema.Struct({
  projectId: ProjectId,
});
export type HostResourceSubscribeInput = typeof HostResourceSubscribeInput.Type;

// ─── Threshold Config ───────────────────────────────────────────────

export const ResourceThresholds = {
  ram: { warn: 80, critical: 92 },
  cpu: { warn: 85, critical: 95, sustainedSeconds: 5 },
  disk: { warn: 85, critical: 95 },
} as const;

// ─── Danger Patterns ────────────────────────────────────────────────

export const KubeDangerPatterns: readonly string[] = ["pd-", "prod-", "production"];

// ─── Error ──────────────────────────────────────────────────────────

export class HostResourceMonitorError extends Schema.TaggedErrorClass<HostResourceMonitorError>()(
  "HostResourceMonitorError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Host resource monitor failed in ${this.operation}: ${this.detail}`;
  }
}
