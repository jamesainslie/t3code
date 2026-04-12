import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ResourceSampler } from "../Services/ResourceSampler.ts";
import { ResourceSamplerLive } from "../Layers/ResourceSampler.ts";

describe("ResourceSampler", () => {
  it("collects a raw sample with all metric fields", async () => {
    const program = Effect.gen(function* () {
      const sampler = yield* ResourceSampler;
      return yield* sampler.collectSample("/tmp");
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(ResourceSamplerLive)));

    // RAM
    expect(result.ram.totalBytes).toBeGreaterThan(0);
    expect(result.ram.usedBytes).toBeGreaterThan(0);
    expect(result.ram.availableBytes).toBeGreaterThanOrEqual(0);
    expect(result.ram.usagePercent).toBeGreaterThan(0);
    expect(result.ram.usagePercent).toBeLessThanOrEqual(100);
    expect(result.ram.swapTotalBytes).toBeGreaterThanOrEqual(0);
    expect(result.ram.swapUsedBytes).toBeGreaterThanOrEqual(0);

    // CPU (first sample may be 0)
    expect(result.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.cpu.usagePercent).toBeLessThanOrEqual(100);
    expect(result.cpu.coreCount).toBeGreaterThan(0);

    // Disk
    expect(result.disk.totalBytes).toBeGreaterThan(0);
    expect(result.disk.mountPath).toBeTruthy();

    // Remote — in test always local
    expect(result.remote.hostname).toBeTruthy();

    // Containers + Kubecontext — nullable, just check shape
    if (result.containers !== null) {
      expect(result.containers.total).toBeGreaterThanOrEqual(0);
    }
    if (result.kubecontext !== null) {
      expect(result.kubecontext.context).toBeTruthy();
    }
  });

  it("returns consistent types for successive samples", async () => {
    const program = Effect.gen(function* () {
      const sampler = yield* ResourceSampler;
      const first = yield* sampler.collectSample("/tmp");
      const second = yield* sampler.collectSample("/tmp");
      return { first, second };
    });

    const { first, second } = await Effect.runPromise(
      program.pipe(Effect.provide(ResourceSamplerLive)),
    );

    // Both samples should have the same structure
    expect(typeof first.ram.totalBytes).toBe("number");
    expect(typeof second.ram.totalBytes).toBe("number");
    expect(typeof first.cpu.coreCount).toBe("number");
    expect(typeof second.cpu.coreCount).toBe("number");
    expect(typeof first.remote.isRemote).toBe("boolean");
    expect(typeof second.remote.isRemote).toBe("boolean");
  });
});
