import * as OS from "node:os";

import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";
import { runProcess } from "../../processRunner.ts";

/**
 * Parse `/proc/meminfo` for swap information on Linux.
 */
const readLinuxSwap = Effect.tryPromise({
  try: async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile("/proc/meminfo", "utf-8");
    let swapTotal = 0;
    let swapFree = 0;
    for (const line of content.split("\n")) {
      if (line.startsWith("SwapTotal:")) {
        swapTotal = parseInt(line.split(/\s+/)[1] ?? "0", 10) * 1024;
      } else if (line.startsWith("SwapFree:")) {
        swapFree = parseInt(line.split(/\s+/)[1] ?? "0", 10) * 1024;
      }
    }
    return { swapTotalBytes: swapTotal, swapUsedBytes: swapTotal - swapFree };
  },
  catch: () => null,
}).pipe(Effect.orElseSucceed(() => null));

/**
 * Parse `sysctl vm.swapusage` for swap on macOS.
 */
const readMacOsSwap = Effect.tryPromise({
  try: () => runProcess("sysctl", ["vm.swapusage"], { allowNonZeroExit: true, timeoutMs: 5_000 }),
  catch: () => null,
}).pipe(
  Effect.map((result) => {
    if (!result || result.code !== 0) return null;
    // Output format: "vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M"
    const parseSize = (label: string): number => {
      const match = result.stdout.match(new RegExp(`${label}\\s*=\\s*([\\d.]+)(\\w)`));
      if (!match) return 0;
      const value = parseFloat(match[1]!);
      const unit = match[2]!.toUpperCase();
      if (unit === "G") return value * 1024 * 1024 * 1024;
      if (unit === "M") return value * 1024 * 1024;
      if (unit === "K") return value * 1024;
      return value;
    };
    return {
      swapTotalBytes: parseSize("total"),
      swapUsedBytes: parseSize("used"),
    };
  }),
  Effect.orElseSucceed(() => null),
);

const readSwap: Effect.Effect<{ swapTotalBytes: number; swapUsedBytes: number }> = Effect.gen(
  function* () {
    if (process.platform === "linux") {
      const linuxSwap = yield* readLinuxSwap;
      if (linuxSwap) return linuxSwap;
    }
    if (process.platform === "darwin") {
      const macSwap = yield* readMacOsSwap;
      if (macSwap) return macSwap;
    }
    return { swapTotalBytes: 0, swapUsedBytes: 0 };
  },
);

export const sampleRam: Effect.Effect<RawSample["ram"]> = Effect.gen(function* () {
  const totalBytes = OS.totalmem();
  const freeBytes = OS.freemem();
  const usedBytes = totalBytes - freeBytes;
  const availableBytes = freeBytes;
  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  const swap = yield* readSwap;

  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePercent,
    swapUsedBytes: swap.swapUsedBytes,
    swapTotalBytes: swap.swapTotalBytes,
  };
});
