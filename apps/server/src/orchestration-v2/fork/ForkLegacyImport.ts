/**
 * Carries fork data across the v1 to v2 cutover, around upstream's
 * `LegacyV1ThreadImporter` (see docs/internals/legacy-orchestration-migration.md).
 *
 * - `prepareContextRecords` runs before upstream's shell import. The fork's v1
 *   thread references carried a `projectId`; upstream's `ThreadContextRecord`
 *   carries an `environmentId`, and the importer decodes message context
 *   strictly, so fork records are rewritten to upstream's shape first.
 * - `importForkFields` runs after it. Highlights, dependency links, snooze
 *   notes, and continuation links live in fork columns of `projection_threads`,
 *   which upstream's importer does not read; they land on the v2 thread as one
 *   `thread.metadata-updated` per thread.
 *
 * Both only touch the v2 database copy, and both are idempotent: rewritten
 * records no longer match, and a field already on the v2 thread is skipped.
 */
import {
  EnvironmentId,
  EventId,
  OrchestrationV2AppThreadJson,
  ThreadDependency,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../EventSink.ts";

const decodeThreadPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeDependencies = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(ThreadDependency)),
);

/** Rewrites one message's context so fork thread records take upstream's shape. */
export function rewriteThreadContextRecords(
  contextJson: string,
  environmentId: EnvironmentId,
): string | null {
  let context: unknown;
  try {
    context = JSON.parse(contextJson);
  } catch {
    return null;
  }
  if (typeof context !== "object" || context === null || !("records" in context)) return null;
  const records = (context as { records: unknown }).records;
  if (!Array.isArray(records)) return null;
  let changed = false;
  const rewritten = records.map((record: unknown) => {
    if (
      typeof record !== "object" ||
      record === null ||
      (record as { kind?: unknown }).kind !== "thread" ||
      "payload" in record ||
      !("projectId" in record) ||
      "environmentId" in record
    ) {
      return record;
    }
    changed = true;
    const { projectId: _projectId, ...rest } = record as Record<string, unknown>;
    return { ...rest, environmentId };
  });
  return changed ? JSON.stringify({ ...context, records: rewritten }) : null;
}

const prepareContextRecords = Effect.fn("ForkLegacyImport.prepareContextRecords")(function* (
  environmentId: EnvironmentId,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_thread_messages'
    `;
  if (tables.length === 0) return 0;
  const rows = yield* sql<{ readonly message_id: string; readonly context_json: string }>`
      SELECT message_id, context_json
      FROM projection_thread_messages
      WHERE context_json LIKE '%"kind":"thread"%' AND context_json LIKE '%"projectId"%'
    `;
  let rewritten = 0;
  for (const row of rows) {
    const next = rewriteThreadContextRecords(row.context_json, environmentId);
    if (next === null) continue;
    yield* sql`
        UPDATE projection_thread_messages SET context_json = ${next}
        WHERE message_id = ${row.message_id}
      `;
    rewritten += 1;
  }
  return rewritten;
});

interface ForkFieldRow {
  readonly thread_id: string;
  readonly highlight_color: string | null;
  readonly dependencies_json: string | null;
  readonly snooze_reminder: string | null;
  readonly continued_from_thread_id: string | null;
  readonly payload_json: string;
}

const importForkFields = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventSink = yield* EventSink.EventSinkV2;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('orchestration_v2_legacy_imports', 'projection_threads')
  `;
  if (tables.length < 2) return 0;
  const rows = yield* sql<ForkFieldRow>`
    SELECT
      thread.thread_id,
      thread.highlight_color,
      thread.dependencies_json,
      thread.snooze_reminder,
      thread.continued_from_thread_id,
      projection.payload_json
    FROM orchestration_v2_legacy_imports AS legacy_import
    INNER JOIN projection_threads AS thread
      ON thread.thread_id = legacy_import.thread_id
    INNER JOIN orchestration_v2_projection_threads AS projection
      ON projection.thread_id = legacy_import.thread_id
    WHERE (thread.highlight_color IS NOT NULL
        AND json_type(projection.payload_json, '$.highlightColor') IS NULL)
       OR (thread.dependencies_json IS NOT NULL AND thread.dependencies_json != '[]'
        AND json_type(projection.payload_json, '$.dependencies') IS NULL)
       OR (thread.snooze_reminder IS NOT NULL AND thread.snooze_reminder != ''
        AND json_type(projection.payload_json, '$.snoozeReminder') IS NULL)
       OR (thread.continued_from_thread_id IS NOT NULL
        AND json_type(projection.payload_json, '$.continuedFromThreadId') IS NULL)
    ORDER BY thread.created_at ASC, thread.thread_id ASC
  `;
  const now = yield* DateTime.now;
  let imported = 0;
  for (const row of rows) {
    const decoded = decodeThreadPayload(row.payload_json);
    if (Option.isNone(decoded)) continue;
    const current = decoded.value;
    const dependencies =
      row.dependencies_json === null
        ? undefined
        : Option.getOrUndefined(decodeDependencies(row.dependencies_json));
    const thread = {
      ...current,
      ...(current.highlightColor === undefined && row.highlight_color !== null
        ? { highlightColor: row.highlight_color }
        : {}),
      ...(current.dependencies === undefined && dependencies !== undefined ? { dependencies } : {}),
      ...(current.snoozeReminder === undefined && row.snooze_reminder
        ? { snoozeReminder: row.snooze_reminder }
        : {}),
      ...(current.continuedFromThreadId === undefined && row.continued_from_thread_id !== null
        ? { continuedFromThreadId: ThreadId.make(row.continued_from_thread_id) }
        : {}),
    };
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`migration:v1:fork:thread:${row.thread_id}:fields`),
          type: "thread.metadata-updated",
          threadId: thread.id,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
    imported += 1;
  }
  return imported;
});

/**
 * Wraps upstream's shell import: fork thread references are rewritten before it, and fork
 * thread fields are carried after it.
 */
export const aroundLegacyImport = <A, E, R, E2, R2>(
  environmentId: Effect.Effect<EnvironmentId, E2, R2>,
  importShells: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const rewritten = yield* prepareContextRecords(yield* environmentId);
    const result = yield* importShells;
    const imported = yield* importForkFields;
    if (rewritten > 0 || imported > 0) {
      yield* Effect.logInfo("Carried fork thread data into v2", { rewritten, imported });
    }
    return result;
  });
