import * as OS from "node:os";

import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";

interface CpuTick {
  readonly idle: number;
  readonly total: number;
}

function aggregateCpuTicks(): CpuTick {
  const cpus = OS.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

/**
 * Creates a CPU sampler that tracks deltas between successive calls.
 * The first sample returns 0% usage since there is no previous snapshot to compare against.
 */
export const makeCpuSampler = (): Effect.Effect<{ sample: Effect.Effect<RawSample["cpu"]> }> =>
  Effect.sync(() => {
    let previousTick: CpuTick | null = null;

    const sample: Effect.Effect<RawSample["cpu"]> = Effect.sync(() => {
      const currentTick = aggregateCpuTicks();
      const coreCount = OS.cpus().length;

      if (previousTick === null) {
        previousTick = currentTick;
        return { usagePercent: 0, coreCount };
      }

      const idleDelta = currentTick.idle - previousTick.idle;
      const totalDelta = currentTick.total - previousTick.total;
      previousTick = currentTick;

      const usagePercent = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;

      return {
        usagePercent: Math.min(100, Math.max(0, usagePercent)),
        coreCount,
      };
    });

    return { sample };
  });
