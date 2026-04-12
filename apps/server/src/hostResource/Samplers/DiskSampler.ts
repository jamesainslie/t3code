import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";
import { runProcess } from "../../processRunner.ts";

const FALLBACK: RawSample["disk"] = {
  totalBytes: 0,
  usedBytes: 0,
  availableBytes: 0,
  usagePercent: 0,
  mountPath: "/",
};

function parseDfOutput(stdout: string): RawSample["disk"] | null {
  // `df -k` outputs 1K blocks. The second line has the data we need.
  // Format: Filesystem 1K-blocks Used Available Use% Mounted on
  const lines = stdout.trim().split("\n");
  if (lines.length < 2) return null;

  // Some systems split a long filesystem name across lines; grab the last line with data.
  const dataLine = lines[lines.length - 1]!;
  const parts = dataLine.trim().split(/\s+/);

  // We need at least 6 columns: filesystem, 1K-blocks, used, available, use%, mounted
  if (parts.length < 6) return null;

  const totalKb = parseInt(parts[1]!, 10);
  const usedKb = parseInt(parts[2]!, 10);
  const availableKb = parseInt(parts[3]!, 10);
  const mountPath = parts.slice(5).join(" "); // mount path can contain spaces

  if (isNaN(totalKb) || isNaN(usedKb) || isNaN(availableKb)) return null;

  const totalBytes = totalKb * 1024;
  const usedBytes = usedKb * 1024;
  const availableBytes = availableKb * 1024;
  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return { totalBytes, usedBytes, availableBytes, usagePercent, mountPath };
}

function runDf(path: string): Effect.Effect<RawSample["disk"]> {
  return Effect.tryPromise({
    try: () => runProcess("df", ["-k", path], { allowNonZeroExit: true, timeoutMs: 5_000 }),
    catch: () => null,
  }).pipe(
    Effect.map((result) => {
      if (!result || result.code !== 0) return null;
      return parseDfOutput(result.stdout);
    }),
    Effect.orElseSucceed(() => null),
    Effect.map((parsed) => parsed ?? FALLBACK),
  );
}

export const sampleDisk = (workspacePath: string): Effect.Effect<RawSample["disk"]> =>
  runDf(workspacePath).pipe(
    Effect.flatMap((result) => {
      // If we got a valid result for the workspace path, use it
      if (result.totalBytes > 0) return Effect.succeed(result);
      // Otherwise, fall back to root
      return runDf("/");
    }),
  );
