/**
 * Fork: background generation usage. Every background text-generation call
 * (titles, branch names, commit and PR text, review guides, the roadmap
 * steward) leaves a row naming its purpose and the provider session that
 * answered. The usage scan files that session's records under the purpose, so
 * the Usage tab shows the spend on its own row. A provider that keeps no
 * history of the call (an ephemeral or deleted session) has its usage stored
 * on the row instead, which the scan reads as this environment's own source.
 *
 * Recording never fails a generation and reading never fails a usage scan:
 * storage errors are logged and the usage stays where it would have been.
 */
import {
  type BackgroundGenerationPurpose,
  UsageProviderKind,
  UsageTokenTotals,
} from "@lathe/contracts";
import {
  type TextGenerationUsageReport,
  TextGenerationUsageReporter,
} from "@lathe/provider-core/server/textGenerationUsageFork";
import type { UsageRecord, UsageSpeed } from "@lathe/provider-core/server/usage";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import { readDirectoryVolumeId } from "../../usage/usageTranscriptReader.ts";

export interface BackgroundUsageWindow {
  /** Purpose of each background call since the window start, by provider and session. */
  readonly purposes: ReadonlyMap<
    UsageProviderKind,
    ReadonlyMap<string, BackgroundGenerationPurpose>
  >;
  /** Usage of calls no provider history holds, one source per provider. */
  readonly sources: ReadonlyArray<{
    readonly provider: UsageProviderKind;
    readonly path: string;
    readonly volumeId: string;
    readonly records: readonly UsageRecord[];
  }>;
}

const EMPTY_WINDOW: BackgroundUsageWindow = { purposes: new Map(), sources: [] };

export interface BackgroundGenerationUsageService {
  readonly record: (
    purpose: BackgroundGenerationPurpose,
    report: TextGenerationUsageReport,
  ) => Effect.Effect<void>;
  /** Calls since `sinceMs`. Rows older than `retentionCutoffMs` are deleted. */
  readonly read: (input: {
    readonly sinceMs: number;
    readonly retentionCutoffMs: number;
  }) => Effect.Effect<BackgroundUsageWindow>;
}

export class BackgroundGenerationUsage extends Context.Reference<BackgroundGenerationUsageService>(
  "lathe/fork/usage/BackgroundGenerationUsage",
  {
    defaultValue: () => ({
      record: () => Effect.void,
      read: () => Effect.succeed(EMPTY_WINDOW),
    }),
  },
) {}

const StoredUsage = Schema.Struct({
  totals: UsageTokenTotals,
  reportedCostUsd: Schema.NullOr(Schema.Number),
  speed: Schema.optional(Schema.Literals(["standard", "fast", "ultrafast"])),
  rateModel: Schema.optional(Schema.String),
});
const StoredUsageJson = Schema.fromJsonString(StoredUsage);
const encodeStoredUsage = Schema.encodeSync(StoredUsageJson);
const decodeStoredUsage = Schema.decodeUnknownOption(StoredUsageJson);
const isProvider = Schema.is(UsageProviderKind);

export interface BackgroundUsageRow {
  readonly rowId: number;
  readonly recordedAtMs: number;
  readonly purpose: BackgroundGenerationPurpose;
  readonly provider: string;
  readonly sessionId: string;
  readonly model: string;
  readonly usageJson: string | null;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig.ServerConfig;
  const path = config.dbPath;

  const record = (purpose: BackgroundGenerationPurpose, report: TextGenerationUsageReport) =>
    Effect.gen(function* () {
      if (report.sessionId.length === 0 && report.usage === undefined) return;
      const recordedAtMs = yield* Clock.currentTimeMillis;
      const usageJson = report.usage === undefined ? null : encodeStoredUsage(report.usage);
      yield* sql`
        INSERT INTO background_generation_usage (
          recorded_at_ms, purpose, provider, session_id, model, usage_json
        ) VALUES (
          ${recordedAtMs}, ${purpose}, ${report.provider}, ${report.sessionId},
          ${report.model}, ${usageJson}
        )
      `;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("background generation usage not recorded", { purpose, cause }),
      ),
    );

  const read = (input: { readonly sinceMs: number; readonly retentionCutoffMs: number }) =>
    Effect.gen(function* () {
      yield* sql`
        DELETE FROM background_generation_usage WHERE recorded_at_ms < ${input.retentionCutoffMs}
      `;
      const rows = yield* sql<BackgroundUsageRow>`
        SELECT
          row_id AS "rowId",
          recorded_at_ms AS "recordedAtMs",
          purpose,
          provider,
          session_id AS "sessionId",
          model,
          usage_json AS "usageJson"
        FROM background_generation_usage
        WHERE recorded_at_ms >= ${input.sinceMs}
        ORDER BY row_id
      `;
      if (rows.length === 0) return EMPTY_WINDOW;
      const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(path));
      return windowFromRows(rows, { path, volumeId });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("background generation usage not read", { cause }).pipe(
          Effect.as(EMPTY_WINDOW),
        ),
      ),
    );

  return { record, read };
});

export function windowFromRows(
  rows: readonly BackgroundUsageRow[],
  source: { readonly path: string; readonly volumeId: string },
): BackgroundUsageWindow {
  const purposes = new Map<UsageProviderKind, Map<string, BackgroundGenerationPurpose>>();
  const records = new Map<UsageProviderKind, UsageRecord[]>();
  for (const row of rows) {
    if (!isProvider(row.provider)) continue;
    const provider = row.provider;
    const sessionId = row.sessionId.length > 0 ? row.sessionId : `background:${row.rowId}`;
    let sessions = purposes.get(provider);
    if (sessions === undefined) {
      sessions = new Map();
      purposes.set(provider, sessions);
    }
    sessions.set(sessionId, row.purpose);
    if (row.usageJson === null) continue;
    const usage = decodeStoredUsage(row.usageJson);
    if (usage._tag === "None") continue;
    const providerRecords = records.get(provider) ?? [];
    providerRecords.push({
      provider,
      timestampMs: row.recordedAtMs,
      model: row.model,
      ...(usage.value.rateModel === undefined ? {} : { rateModel: usage.value.rateModel }),
      sessionId,
      totals: usage.value.totals,
      reportedCostUsd: usage.value.reportedCostUsd,
      speed: usage.value.speed ?? ("standard" satisfies UsageSpeed),
      dedupeKey: `background:${row.rowId}`,
    });
    records.set(provider, providerRecords);
  }
  return {
    purposes,
    sources: [...records].map(([provider, providerRecords]) => ({
      provider,
      ...source,
      records: providerRecords,
    })),
  };
}

export const layer = Layer.effect(BackgroundGenerationUsage, make);

/** Files every usage report a generation makes under `purpose`. */
export const attributeUsage =
  (usage: BackgroundGenerationUsageService, purpose: BackgroundGenerationPurpose) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, TextGenerationUsageReporter, {
      report: (report) => usage.record(purpose, report),
    });
