/**
 * Fork-only schema, kept in its own migration ledger (`fork_sql_migrations`).
 *
 * Upstream's migrator skips every id at or below the highest one recorded, so
 * a fork migration that takes an id upstream later assigns masks upstream's
 * migration forever (docs/internals/legacy-orchestration-migration.md,
 * "Divergent migration ids"). Fork installs recorded their own migrations at
 * ids 49, 50, and 54 to 60 before this ledger existed. `reconcileForkLedger`
 * moves those rows out of upstream's ledger before upstream's migrator runs,
 * so upstream's orchestration v2 schema (55, 56) is created on fork databases.
 *
 * Both functions only ever see the v2 database: `initializeV2Database` copies
 * `state.sqlite` first, and the original stays untouched for the v1 build.
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest } from "../Migrations.ts";
import UpstreamActiveOrderKey from "../Migrations/049_ProjectionThreadsActiveOrderKey.ts";
import UpstreamThreadPullRequests from "../Migrations/050_ProjectionThreadPullRequests.ts";
import UpstreamAutoSettleDisabledAt from "../Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";
import ProjectionThreadsDependencies from "./migrations/001_ProjectionThreadsDependencies.ts";
import ProjectionThreadsHighlight from "./migrations/002_ProjectionThreadsHighlight.ts";
import ProjectionThreadDocumentComments from "./migrations/003_ProjectionThreadDocumentComments.ts";
import ProjectionThreadsSnoozeReminder from "./migrations/004_ProjectionThreadsSnoozeReminder.ts";
import ProjectionThreadsContinuedFrom from "./migrations/005_ProjectionThreadsContinuedFrom.ts";
import ProjectSyncRecords from "./migrations/006_ProjectSyncRecords.ts";

export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

/**
 * The fork's schema changes. Every one checks before it alters, so a database
 * that already ran it under upstream's ledger takes it again harmlessly.
 * Append only; never reuse an id.
 */
const forkMigrationEntries = [
  [1, "ProjectionThreadsDependencies", ProjectionThreadsDependencies],
  [2, "ProjectionThreadsHighlight", ProjectionThreadsHighlight],
  [3, "ProjectionThreadDocumentComments", ProjectionThreadDocumentComments],
  [4, "ProjectionThreadsSnoozeReminder", ProjectionThreadsSnoozeReminder],
  [5, "ProjectionThreadsContinuedFrom", ProjectionThreadsContinuedFrom],
  [6, "ProjectSyncRecords", ProjectSyncRecords],
] as const;

export const forkMigrationManifest = forkMigrationEntries.map(([id, name]) => [id, name] as const);

/**
 * Names fork builds recorded in upstream's ledger. Only these rows are moved:
 * any other unknown row (a local build's migration) stays for upstream's
 * divergence warning.
 */
const LEGACY_FORK_MIGRATION_NAMES: ReadonlySet<string> = new Set([
  "ProjectionThreadPlacement",
  "ForkRepairSkippedUpstreamMigrations",
  "ProjectionThreadsDependencies",
  "ProjectionThreadsHighlight",
  "ProjectionThreadDocumentComments",
  "ForkRepairAutoSettleDisabledAt",
  "ProjectionThreadsSnoozeReminder",
  "ProjectionThreadsContinuedFrom",
]);

/**
 * Upstream migrations the fork's old repair migrations replayed. Their ids sit
 * below the highest upstream id a fork database recorded, so upstream's
 * migrator would never run them again; the reconcile replays them (each checks
 * before it alters) and records them under upstream's name.
 */
const replayedUpstreamMigrations = new Map([
  [49, UpstreamActiveOrderKey],
  [50, UpstreamThreadPullRequests],
  [54, UpstreamAutoSettleDisabledAt],
]);

const ensureForkLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Same shape Migrator creates for SQLite, so the fork migrator reads it as its own.
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_sql_migrations (
      migration_id integer PRIMARY KEY NOT NULL,
      created_at datetime NOT NULL DEFAULT current_timestamp,
      name VARCHAR(255) NOT NULL
    )
  `;
});

/** Moves fork rows out of upstream's ledger; a no-op on databases without any. */
export const reconcileForkLedger = Effect.fn("reconcileForkLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return [];
  const upstreamNames = new Map<number, string>(migrationManifest);
  const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id ASC
  `;
  const forkRows = recorded.filter(
    (row) =>
      upstreamNames.get(row.migration_id) !== row.name && LEGACY_FORK_MIGRATION_NAMES.has(row.name),
  );
  if (forkRows.length === 0) return [];
  const forkIds = new Map<string, number>(forkMigrationEntries.map(([id, name]) => [name, id]));
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* ensureForkLedger;
      const moved: Array<readonly [number, string]> = [];
      for (const row of forkRows) {
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${row.migration_id}`;
        const replay = replayedUpstreamMigrations.get(row.migration_id);
        const upstreamName = upstreamNames.get(row.migration_id);
        if (replay !== undefined && upstreamName !== undefined) {
          yield* replay;
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name)
            VALUES (${row.migration_id}, ${upstreamName})
          `;
        }
        // Fork schema already applied under upstream's ledger counts as run here.
        const forkId = forkIds.get(row.name);
        if (forkId !== undefined) {
          yield* sql`
            INSERT OR IGNORE INTO fork_sql_migrations (migration_id, name)
            VALUES (${forkId}, ${row.name})
          `;
        }
        moved.push([row.migration_id, row.name]);
      }
      yield* Effect.log("Moved fork migrations out of the upstream ledger").pipe(
        Effect.annotateLogs({ moved: moved.map(([id, name]) => `${id}:${name}`) }),
      );
      return moved;
    }),
  );
});

const runFork = Migrator.make({});

/** Runs pending fork migrations from the fork ledger. */
export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  yield* ensureForkLedger;
  const executed = yield* runFork({
    table: FORK_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });
  if (executed.length > 0) {
    yield* Effect.log("Fork migrations ran successfully").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return executed;
});
