import { Context } from "effect";
import type { Effect } from "effect";

export interface RawSample {
  readonly ram: {
    readonly totalBytes: number;
    readonly usedBytes: number;
    readonly availableBytes: number;
    readonly usagePercent: number;
    readonly swapUsedBytes: number;
    readonly swapTotalBytes: number;
  };
  readonly cpu: {
    readonly usagePercent: number;
    readonly coreCount: number;
  };
  readonly disk: {
    readonly totalBytes: number;
    readonly usedBytes: number;
    readonly availableBytes: number;
    readonly usagePercent: number;
    readonly mountPath: string;
  };
  readonly containers: {
    readonly running: number;
    readonly stopped: number;
    readonly total: number;
  } | null;
  readonly kubecontext: {
    readonly context: string;
    readonly cluster: string;
    readonly namespace: string;
  } | null;
  readonly remote: {
    readonly isRemote: boolean;
    readonly hostname: string;
    readonly fqdn: string;
    readonly isRoot: boolean;
  };
}

export interface ResourceSamplerShape {
  readonly collectSample: (workspacePath: string) => Effect.Effect<RawSample>;
}

export class ResourceSampler extends Context.Service<ResourceSampler, ResourceSamplerShape>()(
  "t3/hostResource/Services/ResourceSampler",
) {}
