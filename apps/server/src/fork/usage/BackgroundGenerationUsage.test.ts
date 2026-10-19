import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { reportTextGenerationUsage } from "@lathe/provider-core/server/textGenerationUsageFork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { attributeUsage, BackgroundGenerationUsage, layer } from "./BackgroundGenerationUsage.ts";

const totals = {
  uncachedInputTokens: 200,
  cachedInputTokens: 1000,
  cacheCreationTokens: 0,
  outputTokens: 80,
  reasoningTokens: 30,
};

const layerUsage = () =>
  layer.pipe(
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "lathe-background-usage-" })),
    ),
  );

it.layer(NodeServices.layer)("background generation usage", (it) => {
  it.effect("files a tagged session under its purpose and keeps a recorded call's usage", () =>
    Effect.gen(function* () {
      const usage = yield* BackgroundGenerationUsage;
      yield* TestClock.setTime(Date.parse("2026-10-19T09:00:00.000Z"));
      yield* reportTextGenerationUsage({
        provider: "claude",
        sessionId: "claude-session",
        model: "claude-opus-5-5",
      }).pipe(attributeUsage(usage, "roadmapSteward"));
      yield* reportTextGenerationUsage({
        provider: "codex",
        sessionId: "codex-thread",
        model: "gpt-5.5",
        usage: { totals, reportedCostUsd: null, speed: "fast" },
      }).pipe(attributeUsage(usage, "threadTitle"));

      const window = yield* usage.read({ sinceMs: 0, retentionCutoffMs: 0 });

      assert.strictEqual(window.purposes.get("claude")?.get("claude-session"), "roadmapSteward");
      assert.strictEqual(window.purposes.get("codex")?.get("codex-thread"), "threadTitle");
      assert.strictEqual(window.sources.length, 1);
      const [source] = window.sources;
      assert.strictEqual(source?.provider, "codex");
      assert.deepStrictEqual(source?.records, [
        {
          provider: "codex",
          timestampMs: Date.parse("2026-10-19T09:00:00.000Z"),
          model: "gpt-5.5",
          sessionId: "codex-thread",
          totals,
          reportedCostUsd: null,
          speed: "fast",
          dedupeKey: "background:2",
        },
      ]);
    }).pipe(Effect.provide(layerUsage())),
  );

  it.effect("gives a recorded call without a session id a purpose of its own", () =>
    Effect.gen(function* () {
      const usage = yield* BackgroundGenerationUsage;
      yield* usage.record("commitMessage", {
        provider: "pi",
        sessionId: "",
        model: "anthropic/claude-haiku-5-5",
        usage: { totals, reportedCostUsd: 0.01, rateModel: "claude-haiku-5-5" },
      });

      const window = yield* usage.read({ sinceMs: 0, retentionCutoffMs: 0 });

      const [record] = window.sources[0]?.records ?? [];
      assert.strictEqual(record?.rateModel, "claude-haiku-5-5");
      assert.strictEqual(
        window.purposes.get("pi")?.get(record?.sessionId ?? "missing"),
        "commitMessage",
      );
    }).pipe(Effect.provide(layerUsage())),
  );

  it.effect("drops calls older than the retention cutoff", () =>
    Effect.gen(function* () {
      const usage = yield* BackgroundGenerationUsage;
      yield* TestClock.setTime(1_000);
      yield* usage.record("branchName", { provider: "claude", sessionId: "old", model: "m" });
      yield* TestClock.setTime(5_000);
      yield* usage.record("branchName", { provider: "claude", sessionId: "new", model: "m" });

      yield* usage.read({ sinceMs: 5_000, retentionCutoffMs: 2_000 });
      const window = yield* usage.read({ sinceMs: 0, retentionCutoffMs: 0 });

      assert.deepStrictEqual([...(window.purposes.get("claude")?.keys() ?? [])], ["new"]);
    }).pipe(Effect.provide(layerUsage())),
  );
});
