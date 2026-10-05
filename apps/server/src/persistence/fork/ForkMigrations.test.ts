import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, runMigrations } from "../Migrations.ts";
import UpstreamAutoSettleDisabledAt from "../Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";
import { forkMigrationManifest, reconcileForkLedger, runForkMigrations } from "./ForkMigrations.ts";
import ProjectionThreadsDependencies from "./migrations/001_ProjectionThreadsDependencies.ts";
import ProjectionThreadsHighlight from "./migrations/002_ProjectionThreadsHighlight.ts";
import ProjectionThreadDocumentComments from "./migrations/003_ProjectionThreadDocumentComments.ts";
import ProjectionThreadsSnoozeReminder from "./migrations/004_ProjectionThreadsSnoozeReminder.ts";
import ProjectionThreadsContinuedFrom from "./migrations/005_ProjectionThreadsContinuedFrom.ts";

/** What the server's persistence setup runs, in order. */
const migrateLikeTheServer = Effect.gen(function* () {
  const moved = yield* reconcileForkLedger();
  const upstream = yield* runMigrations();
  const fork = yield* runForkMigrations();
  return { moved, upstream, fork };
});

/** Fork rows as fork builds recorded them in upstream's ledger, after 053. */
const LEGACY_FORK_ROWS = [
  [54, "ForkRepairSkippedUpstreamMigrations"],
  [55, "ProjectionThreadsDependencies"],
  [56, "ProjectionThreadsHighlight"],
  [57, "ProjectionThreadDocumentComments"],
  [58, "ForkRepairAutoSettleDisabledAt"],
  [59, "ProjectionThreadsSnoozeReminder"],
  [60, "ProjectionThreadsContinuedFrom"],
] as const;

/** A fork database as the last v1 fork build left it: fork schema applied, fork rows recorded. */
const seedLegacyForkDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 53 });
  yield* UpstreamAutoSettleDisabledAt;
  yield* ProjectionThreadsDependencies;
  yield* ProjectionThreadsHighlight;
  yield* ProjectionThreadDocumentComments;
  yield* ProjectionThreadsSnoozeReminder;
  yield* ProjectionThreadsContinuedFrom;
  for (const [id, name] of LEGACY_FORK_ROWS) {
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
  }
  const now = "2026-09-01T00:00:00.000Z";
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode, created_at, updated_at,
      highlight_color, snooze_reminder, continued_from_thread_id, dependencies_json
    ) VALUES (
      'thread-1', 'project-1', 'Fork thread', '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access', ${now}, ${now}, '#ff8800', 'Check the deploy', 'thread-0', '[]'
    )
  `;
  yield* sql`
    INSERT INTO projection_thread_document_comments (
      thread_id, comment_id, file_path, anchor_json, body, status, created_at, updated_at
    ) VALUES ('thread-1', 'comment-1', 'README.md', '{}', 'Tighten this', 'open', ${now}, ${now})
  `;
});

const readLedgers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const upstream = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT migration_id AS id, name FROM effect_sql_migrations ORDER BY migration_id ASC
  `;
  const fork = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT migration_id AS id, name FROM fork_sql_migrations ORDER BY migration_id ASC
  `;
  return {
    upstream: upstream.map((row) => [row.id, row.name] as const),
    fork: fork.map((row) => [row.id, row.name] as const),
  };
});

const hasTable = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`;
    return rows.length === 1;
  });

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "fork ledger on a fork database",
  (it) => {
    it.effect("moves fork rows out so upstream's v2 schema is created", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedLegacyForkDatabase;

        const first = yield* migrateLikeTheServer;

        assert.deepStrictEqual(
          first.moved.map(([id]) => id),
          LEGACY_FORK_ROWS.map(([id]) => id),
        );
        assert.deepStrictEqual(
          first.upstream.map(([id]) => id),
          [55, 56],
        );
        assert.deepStrictEqual(first.fork, []);
        const ledgers = yield* readLedgers;
        assert.deepStrictEqual(ledgers.upstream, migrationManifest);
        assert.deepStrictEqual(ledgers.fork, forkMigrationManifest);
        assert.isTrue(yield* hasTable("orchestration_v2_projection_threads"));

        // Fork data written by the v1 build is still there for the cutover import.
        const thread = yield* sql<{
          readonly highlight: string | null;
          readonly reminder: string | null;
          readonly continuedFrom: string | null;
        }>`
          SELECT highlight_color AS highlight, snooze_reminder AS reminder,
            continued_from_thread_id AS "continuedFrom"
          FROM projection_threads WHERE thread_id = 'thread-1'
        `;
        assert.deepStrictEqual(thread, [
          { highlight: "#ff8800", reminder: "Check the deploy", continuedFrom: "thread-0" },
        ]);
        const comments = yield* sql`SELECT comment_id FROM projection_thread_document_comments`;
        assert.strictEqual(comments.length, 1);

        const second = yield* migrateLikeTheServer;
        assert.deepStrictEqual(second, { moved: [], upstream: [], fork: [] });
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "fork ledger on an older fork database",
  (it) => {
    it.effect("records the placement rows at 49 and 50 under upstream's names", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 48 });
        // The fork's placement migration ran as 49 and again as 50 before upstream shipped
        // its own 049 and 050; the fork's later repair replayed upstream's two.
        yield* sql`ALTER TABLE projection_threads ADD COLUMN active_order_key TEXT`;
        for (const id of [49, 50]) {
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name)
            VALUES (${id}, 'ProjectionThreadPlacement')
          `;
        }
        yield* runMigrations();
        // Only the fork's rows at upstream ids remain to reconcile here.
        yield* migrateLikeTheServer;

        const ledgers = yield* readLedgers;
        assert.deepStrictEqual(ledgers.upstream, migrationManifest);
        assert.deepStrictEqual(ledgers.fork, forkMigrationManifest);
        assert.isTrue(yield* hasTable("projection_thread_pull_requests"));
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "fork ledger on a fresh database",
  (it) => {
    it.effect("runs upstream's migrations, then the fork's from its own ledger", () =>
      Effect.gen(function* () {
        const result = yield* migrateLikeTheServer;

        assert.deepStrictEqual(result.moved, []);
        assert.deepStrictEqual(
          result.upstream.map(([id]) => id),
          migrationManifest.map(([id]) => id),
        );
        assert.deepStrictEqual(result.fork, forkMigrationManifest);
        assert.isTrue(yield* hasTable("projection_thread_document_comments"));
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "fork ledger beside a local build's migration",
  (it) => {
    it.effect("leaves unknown rows for upstream's divergence warning", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrateLikeTheServer;
        yield* sql`UPDATE effect_sql_migrations SET name = 'LocalOnlyMigration' WHERE migration_id = 41`;

        const result = yield* migrateLikeTheServer;

        assert.deepStrictEqual(result.moved, []);
        const ledgers = yield* readLedgers;
        assert.deepStrictEqual(
          ledgers.upstream.find(([id]) => id === 41),
          [41, "LocalOnlyMigration"],
        );
      }),
    );
  },
);
