import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@lathe/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "../Migrations.ts";
import UpstreamAutoSettleDisabledAt from "../Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";
import { forkMigrationManifest, reconcileForkLedger, runForkMigrations } from "./ForkMigrations.ts";
import ProjectionThreadsDependencies from "./migrations/001_ProjectionThreadsDependencies.ts";
import ProjectionThreadsHighlight from "./migrations/002_ProjectionThreadsHighlight.ts";
import ProjectionThreadDocumentComments from "./migrations/003_ProjectionThreadDocumentComments.ts";
import ProjectionThreadsSnoozeReminder from "./migrations/004_ProjectionThreadsSnoozeReminder.ts";
import ProjectionThreadsContinuedFrom from "./migrations/005_ProjectionThreadsContinuedFrom.ts";
import Roadmap from "./migrations/007_Roadmap.ts";
import RoadmapCalendar from "./migrations/008_RoadmapCalendar.ts";
import RoadmapProgressNotes from "./migrations/010_RoadmapProgressNotes.ts";
import RoadmapGitHubSync from "./migrations/011_RoadmapGitHubSync.ts";

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
  for (const [version, id, sourceId] of [
    [0, "batch-1", "source-1"],
    [1, "continue-1", "continuation"],
  ] as const) {
    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
      ) VALUES (
        ${`event-${id}`}, 'project', 'sync-source-1', ${version}, 'project.sync-recorded', ${now},
        ${id}, NULL, ${id}, 'server',
        json_object('id', ${id}, 'sourceId', ${sourceId}, 'sourceHome', '/source', 'createdAt', ${now}),
        '{}'
      )
    `;
  }
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
        // Every upstream migration after 054, the last one the v1 fork build applied.
        assert.deepStrictEqual(
          first.upstream.map(([id]) => id),
          migrationManifest.filter(([id]) => id > 54).map(([id]) => id),
        );
        // Only fork migrations newer than the v1 fork build run.
        assert.deepStrictEqual(first.fork, [
          [6, "ProjectSyncRecords"],
          [7, "Roadmap"],
          [8, "RoadmapCalendar"],
          [9, "RoadmapLinkOutbox"],
          [10, "RoadmapProgressNotes"],
          [11, "RoadmapGitHubSync"],
        ]);
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
        // Sync history moves to its own table; continuation bookkeeping does not.
        const records = yield* sql<{ readonly id: string }>`
          SELECT record_id AS id FROM fork_project_sync_records ORDER BY position
        `;
        assert.deepStrictEqual(records, [{ id: "batch-1" }]);

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
        for (const table of [
          "roadmap_events",
          "roadmap_command_receipts",
          "projection_roadmap_items",
          "projection_roadmap_attachments",
          "projection_roadmap_sprints",
          "roadmap_link_outbox",
        ]) {
          assert.isTrue(yield* hasTable(table), table);
        }
      }),
    );

    it.effect("runs the roadmap migration again harmlessly", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO roadmap_events (
            event_id, command_id, item_id, event_type, actor_json, payload_json, occurred_at
          ) VALUES ('event-1', 'cmd-1', 'item-1', 'roadmap.item.created', '{}', '{}', 'now')
        `;
        yield* Roadmap;
        const rows = yield* sql`SELECT event_id FROM roadmap_events`;
        assert.strictEqual(rows.length, 1);
      }),
    );
  },
);

/** A work item as phase 1 stored it, before the calendar fields existed. */
const phaseOneItem = (itemId: string, state: string, createdAt: string, updatedAt: string) =>
  JSON.stringify({
    id: itemId,
    type: "story",
    title: `Story ${itemId}`,
    description: "",
    parentId: null,
    sortKey: "n",
    state,
    priority: null,
    area: null,
    dueDate: null,
    startDate: null,
    estimate: 2,
    criteria: [],
    blockedBy: [],
    externalBlockers: [],
    related: [],
    attachments: [],
    origin: null,
    needsReview: false,
    createdAt,
    updatedAt,
    createdBy: { _tag: "user" },
  });

const calendarFields = (payload: string) => {
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  return {
    stateChangedAt: parsed.stateChangedAt,
    completedAt: parsed.completedAt,
    pinnedAt: parsed.pinnedAt,
    snoozedUntil: parsed.snoozedUntil,
    sprintId: parsed.sprintId,
    hours: parsed.hours,
  };
};

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "roadmap calendar migration on a phase 1 roadmap",
  (it) => {
    it.effect("backfills history fields on items and created events, and adds sprints", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        yield* Roadmap;
        const created = "2026-10-01T09:00:00.000Z";
        const doneAt = "2026-10-10T09:00:00.000Z";
        const touchedAt = "2026-10-12T09:00:00.000Z";
        yield* sql`
          INSERT INTO projection_roadmap_items (
            item_id, parent_id, sort_key, deleted_at, payload_json, updated_sequence
          ) VALUES
            ('done-1', NULL, 'n', NULL, ${phaseOneItem("done-1", "done", created, doneAt)}, 2),
            ('open-1', NULL, 'p', NULL, ${phaseOneItem("open-1", "backlog", created, touchedAt)}, 3)
        `;
        yield* sql`
          INSERT INTO roadmap_events (
            event_id, command_id, item_id, event_type, actor_json, payload_json, occurred_at
          ) VALUES
            ('event-1', 'cmd-1', 'done-1', 'roadmap.item.created', '{"_tag":"user"}',
              ${`{"item":${phaseOneItem("done-1", "done", created, created)}}`}, ${created}),
            ('event-2', 'cmd-2', 'open-1', 'roadmap.item.created', '{"_tag":"user"}',
              ${`{"item":${phaseOneItem("open-1", "backlog", created, created)}}`}, ${created}),
            ('event-3', 'cmd-3', 'open-1', 'roadmap.item.updated', '{"_tag":"user"}',
              '{"title":"Renamed"}', ${touchedAt})
        `;

        yield* RoadmapCalendar;

        const items = yield* sql<{ readonly id: string; readonly payload: string }>`
          SELECT item_id AS id, payload_json AS payload FROM projection_roadmap_items
          ORDER BY item_id
        `;
        const empty = { pinnedAt: null, snoozedUntil: null, sprintId: null, hours: [] };
        assert.deepStrictEqual(
          items.map((row) => [row.id, calendarFields(row.payload)]),
          [
            ["done-1", { stateChangedAt: doneAt, completedAt: doneAt, ...empty }],
            ["open-1", { stateChangedAt: touchedAt, completedAt: null, ...empty }],
          ],
        );
        const events = yield* sql<{ readonly id: string; readonly payload: string }>`
          SELECT event_id AS id, payload_json AS payload FROM roadmap_events ORDER BY sequence
        `;
        // A replay starts each item from its creation, so created events take the creation time.
        assert.deepStrictEqual(
          events.map((row): readonly [string, unknown] => {
            const payload = JSON.parse(row.payload) as { readonly item?: unknown };
            return [
              row.id,
              payload.item === undefined ? payload : calendarFields(JSON.stringify(payload.item)),
            ];
          }),
          [
            ["event-1", { stateChangedAt: created, completedAt: created, ...empty }],
            ["event-2", { stateChangedAt: created, completedAt: null, ...empty }],
            ["event-3", { title: "Renamed" }],
          ],
        );
        assert.isTrue(yield* hasTable("projection_roadmap_sprints"));

        // Running again never overwrites values written since.
        yield* sql`
          UPDATE projection_roadmap_items
          SET payload_json = json_set(payload_json, '$.pinnedAt', ${touchedAt})
          WHERE item_id = 'open-1'
        `;
        yield* RoadmapCalendar;
        const rerun = yield* sql<{ readonly payload: string }>`
          SELECT payload_json AS payload FROM projection_roadmap_items WHERE item_id = 'open-1'
        `;
        assert.strictEqual(calendarFields(rerun[0]!.payload).pinnedAt, touchedAt);
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "roadmap progress notes migration",
  (it) => {
    it.effect("gives existing items no notes and keeps notes written since", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        yield* Roadmap;
        yield* RoadmapCalendar;
        const at = "2026-10-01T09:00:00.000Z";
        const note = { id: "n1", at, actor: { _tag: "user" }, kind: "progress", text: "Hi" };
        const noted = JSON.stringify({
          ...JSON.parse(phaseOneItem("noted-1", "backlog", at, at)),
          progressNotes: [{ ...note, criterionId: null }],
        });
        yield* sql`
          INSERT INTO projection_roadmap_items (
            item_id, parent_id, sort_key, deleted_at, payload_json, updated_sequence
          ) VALUES
            ('plain-1', NULL, 'n', NULL, ${phaseOneItem("plain-1", "backlog", at, at)}, 1),
            ('noted-1', NULL, 'p', NULL, ${noted}, 2)
        `;

        yield* RoadmapProgressNotes;
        yield* RoadmapProgressNotes;

        const items = yield* sql<{ readonly id: string; readonly payload: string }>`
          SELECT item_id AS id, payload_json AS payload FROM projection_roadmap_items
          ORDER BY item_id
        `;
        assert.deepStrictEqual(
          items.map((row) => [row.id, JSON.parse(row.payload).progressNotes]),
          [
            ["noted-1", [{ ...note, criterionId: null }]],
            ["plain-1", []],
          ],
        );
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "roadmap GitHub sync migration",
  (it) => {
    it.effect("gives existing items no issue and no pull requests and keeps those set since", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        yield* Roadmap;
        yield* RoadmapCalendar;
        const at = "2026-10-01T09:00:00.000Z";
        const link = { host: "github.com", repository: "a/b", number: 1, url: "https://x" };
        const linked = JSON.stringify({
          ...JSON.parse(phaseOneItem("linked-1", "backlog", at, at)),
          pullRequests: [link],
        });
        yield* sql`
          INSERT INTO projection_roadmap_items (
            item_id, parent_id, sort_key, deleted_at, payload_json, updated_sequence
          ) VALUES
            ('plain-1', NULL, 'n', NULL, ${phaseOneItem("plain-1", "backlog", at, at)}, 1),
            ('linked-1', NULL, 'p', NULL, ${linked}, 2)
        `;

        yield* RoadmapGitHubSync;
        yield* RoadmapGitHubSync;

        const items = yield* sql<{ readonly id: string; readonly payload: string }>`
          SELECT item_id AS id, payload_json AS payload FROM projection_roadmap_items
          ORDER BY item_id
        `;
        assert.deepStrictEqual(
          items.map((row) => {
            const payload = JSON.parse(row.payload);
            return [row.id, payload.source, payload.pullRequests];
          }),
          [
            ["linked-1", null, [link]],
            ["plain-1", null, []],
          ],
        );
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
