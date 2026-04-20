import { describe, expect, it } from "vitest";
import { Effect, Layer, Stream } from "effect";
import { HostResourceMonitor } from "../Services/HostResourceMonitor.ts";
import { makeHostResourceMonitorLive } from "../Layers/HostResourceMonitor.ts";
import { ResourceSampler, type RawSample } from "../Services/ResourceSampler.ts";
import { ThresholdEvaluatorLive } from "../Layers/ThresholdEvaluator.ts";

// ─── Helpers ───────────────────────────────────────────────────────

const FAST_INTERVAL_MS = 10;

const makeNormalSample = (): RawSample => ({
  ram: {
    totalBytes: 32e9,
    usedBytes: 16e9,
    availableBytes: 16e9,
    usagePercent: 50,
    swapUsedBytes: 0,
    swapTotalBytes: 0,
  },
  cpu: { usagePercent: 10, coreCount: 10 },
  disk: {
    totalBytes: 1e12,
    usedBytes: 3e11,
    availableBytes: 7e11,
    usagePercent: 30,
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
});

function makeTestLayer(samplerLayer: Layer.Layer<ResourceSampler>) {
  return makeHostResourceMonitorLive({ sampleIntervalMs: FAST_INTERVAL_MS }).pipe(
    Layer.provide(Layer.merge(samplerLayer, ThresholdEvaluatorLive)),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("HostResourceMonitor", () => {
  it("emits a snapshot as the first event on subscribe", async () => {
    const mockSamplerLayer = Layer.succeed(ResourceSampler, {
      collectSample: () => Effect.succeed(makeNormalSample()),
    });

    const testLayer = makeTestLayer(mockSamplerLayer);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const monitor = yield* HostResourceMonitor;
          const events = yield* monitor.subscribe("/tmp").pipe(Stream.take(1), Stream.runCollect);
          return Array.from(events);
        }),
      ).pipe(Effect.provide(testLayer)),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("snapshot");
    expect(result[0]!.data.ram.usagePercent).toBe(50);
  });

  it("emits transition events when thresholds are crossed", async () => {
    let callCount = 0;
    const normalSample = makeNormalSample();
    const highRamSample: RawSample = {
      ...normalSample,
      ram: {
        ...normalSample.ram,
        usagePercent: 85,
        usedBytes: 27.2e9,
        availableBytes: 4.8e9,
      },
    };

    const samples: RawSample[] = [
      normalSample, // initial snapshot sample
      normalSample, // first loop sample (normal, no transition)
      highRamSample, // threshold cross!
    ];

    const mockSamplerLayer = Layer.succeed(ResourceSampler, {
      collectSample: () => Effect.sync(() => samples[Math.min(callCount++, samples.length - 1)]!),
    });

    const testLayer = makeTestLayer(mockSamplerLayer);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const monitor = yield* HostResourceMonitor;
          const events = yield* monitor.subscribe("/tmp").pipe(
            Stream.take(2), // snapshot + one transition
            Stream.runCollect,
          );
          return Array.from(events);
        }),
      ).pipe(Effect.provide(testLayer)),
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe("snapshot");
    expect(result[1]!.type).toBe("transition");
    if (result[1]!.type === "transition") {
      expect(result[1]!.metric).toBe("ram");
      expect(result[1]!.previousState).toBe("normal");
      expect(result[1]!.currentState).toBe("warn");
    }
  });

  it("does not emit events when state does not change", async () => {
    const mockSamplerLayer = Layer.succeed(ResourceSampler, {
      collectSample: () => Effect.succeed(makeNormalSample()),
    });

    const testLayer = makeTestLayer(mockSamplerLayer);

    // Subscribe and collect the snapshot plus whatever arrives in a short window.
    // With a stable normal sample, only the snapshot should arrive.
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const monitor = yield* HostResourceMonitor;
          // Take only 1 — the snapshot. The stream should not produce transitions.
          const events = yield* monitor.subscribe("/tmp").pipe(Stream.take(1), Stream.runCollect);
          return Array.from(events);
        }),
      ).pipe(Effect.provide(testLayer)),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("snapshot");
  });
});
