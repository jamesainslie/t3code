// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type * as NodeSqlite from "node:sqlite";
import {
  ChatAttachment,
  DEFAULT_MODEL,
  IsoDateTime,
  ModelSelection,
  ProjectSyncProjectSnapshot,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { openReadOnlyDatabase, snapshotDatabase } from "./SqliteSnapshot.ts";

/** One message of a source conversation, as the sync imports it. */
export const SyncMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  createdAt: IsoDateTime,
});
export type SyncMessage = typeof SyncMessage.Type;

/** Historical tool work. It is shown, never re-run. */
export const SyncActivity = Schema.Struct({
  id: Schema.String,
  tone: Schema.Literals(["info", "tool", "error"]),
  kind: Schema.String,
  summary: Schema.String,
  details: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type SyncActivity = typeof SyncActivity.Type;

export const SyncThread = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  messages: Schema.Array(SyncMessage),
  activities: Schema.Array(SyncActivity),
});
export type SyncThread = typeof SyncThread.Type;

export const SyncSource = Schema.Struct({
  /** The orchestration version of the source install's database. */
  version: Schema.Literals([1, 2]),
  sourceHome: Schema.String,
  sourceId: Schema.String,
  contentHash: Schema.String,
  projects: Schema.Array(
    Schema.Struct({
      project: ProjectSyncProjectSnapshot,
      threads: Schema.Array(SyncThread),
      warnings: Schema.Array(Schema.String),
    }),
  ),
});
export type SyncSource = typeof SyncSource.Type;

export function contentHash(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const decodeProject = Schema.decodeUnknownSync(ProjectSyncProjectSnapshot);
const decodeThread = Schema.decodeUnknownSync(SyncThread);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeAttachments = Schema.decodeUnknownOption(Schema.Array(ChatAttachment));
const json = (value: unknown, fallback: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : fallback;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

type Row = Record<string, unknown>;

function modelSelection(value: unknown) {
  return Option.getOrElse(decodeModelSelection(value), () => ({
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  }));
}

function attachments(value: unknown) {
  return Option.getOrElse(decodeAttachments(value ?? []), () => []);
}

function runtimeMode(value: unknown): SyncThread["runtimeMode"] {
  return value === "approval-required" ||
    value === "auto-accept-edits" ||
    value === "auto" ||
    value === "full-access"
    ? value
    : "full-access";
}

function interactionMode(value: unknown): SyncThread["interactionMode"] {
  return value === "plan" ? "plan" : "default";
}

function tableColumns(db: NodeSqlite.DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare("SELECT name FROM pragma_table_info(?)")
      .all(table)
      .map((row) => String(row.name)),
  );
}

function requireColumns(
  db: NodeSqlite.DatabaseSync,
  required: Record<string, ReadonlyArray<string>>,
) {
  for (const [table, columns] of Object.entries(required)) {
    const present = tableColumns(db, table);
    for (const column of columns) {
      if (!present.has(column))
        throw new Error(`Unsupported source schema: ${table}.${column} is missing`);
    }
  }
}

const PROJECT_COLUMNS = [
  "project_id",
  "title",
  "workspace_root",
  "scripts_json",
  "created_at",
  "updated_at",
  "deleted_at",
  "default_model_selection_json",
];

/** Adds plans as system messages so they read as history without becoming actionable. */
function withPlans(messages: SyncMessage[], plans: ReadonlyArray<SyncMessage>): SyncMessage[] {
  if (plans.length === 0) return messages;
  return [...messages, ...plans].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function planMessage(id: string, markdown: string, createdAt: string): SyncMessage {
  return {
    id: `historical-plan-${id}`,
    role: "system",
    text: `Historical proposed plan:\n\n${markdown}`,
    attachments: [],
    createdAt,
  };
}

interface SourceThreadReader {
  readonly required: Record<string, ReadonlyArray<string>>;
  /** Live threads of one project with the reason a thread must wait, if any. */
  readonly threads: (projectId: string) => ReadonlyArray<{
    readonly row: Row;
    readonly title: string;
    readonly busy: boolean;
  }>;
  readonly read: (row: Row) => unknown;
}

/** Reads an install still on the v1 orchestrator (`state.sqlite`). */
function v1Reader(db: NodeSqlite.DatabaseSync, tables: ReadonlySet<string>): SourceThreadReader {
  return {
    required: {
      projection_threads: [
        "thread_id",
        "project_id",
        "title",
        "model_selection_json",
        "runtime_mode",
        "interaction_mode",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      projection_thread_messages: [
        "message_id",
        "thread_id",
        "role",
        "text",
        "is_streaming",
        "created_at",
        "updated_at",
      ],
    },
    threads: (projectId) =>
      db
        .prepare(
          "SELECT * FROM projection_threads WHERE project_id = ? AND deleted_at IS NULL ORDER BY thread_id",
        )
        .all(projectId)
        .map((row) => {
          const streaming = db
            .prepare(
              "SELECT 1 FROM projection_thread_messages WHERE thread_id = ? AND is_streaming = 1 LIMIT 1",
            )
            .get(row.thread_id as string);
          const running =
            tables.has("projection_turns") &&
            db
              .prepare(
                "SELECT 1 FROM projection_turns WHERE thread_id = ? AND state IN ('pending', 'running') LIMIT 1",
              )
              .get(row.thread_id as string);
          return { row, title: text(row.title), busy: Boolean(streaming || running) };
        }),
    read: (thread) => {
      const threadId = thread.thread_id as string;
      const messages: SyncMessage[] = db
        .prepare(
          "SELECT * FROM projection_thread_messages WHERE thread_id = ? ORDER BY created_at, rowid",
        )
        .all(threadId)
        .map((message) => ({
          id: text(message.message_id),
          role: message.role as SyncMessage["role"],
          text: text(message.text),
          attachments: attachments(json(message.attachments_json, [])),
          createdAt: text(message.created_at),
        }));
      const activities: SyncActivity[] = tables.has("projection_thread_activities")
        ? db
            .prepare(
              "SELECT * FROM projection_thread_activities WHERE thread_id = ? ORDER BY created_at, rowid",
            )
            .all(threadId)
            .map((activity) => ({
              id: text(activity.activity_id),
              tone:
                activity.tone === "error" ? "error" : activity.tone === "tool" ? "tool" : "info",
              kind: text(activity.kind),
              summary: text(activity.summary),
              details: json(activity.payload_json, null),
              createdAt: text(activity.created_at),
            }))
        : [];
      const plans = tables.has("projection_thread_proposed_plans")
        ? db
            .prepare(
              "SELECT * FROM projection_thread_proposed_plans WHERE thread_id = ? ORDER BY created_at, rowid",
            )
            .all(threadId)
            .map((plan) =>
              planMessage(text(plan.plan_id), text(plan.plan_markdown), text(plan.created_at)),
            )
        : [];
      return {
        id: threadId,
        title: text(thread.title),
        modelSelection: modelSelection(json(thread.model_selection_json, null)),
        runtimeMode: runtimeMode(thread.runtime_mode),
        interactionMode: interactionMode(thread.interaction_mode),
        branch: typeof thread.branch === "string" ? thread.branch : null,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        messages: withPlans(messages, plans),
        activities,
      };
    },
  };
}

const V2_MESSAGE_ITEM_TYPES = new Set(["user_message", "assistant_message", "reasoning"]);

/** Reads an install on orchestration v2 (`statev2.sqlite`). */
function v2Reader(db: NodeSqlite.DatabaseSync, tables: ReadonlySet<string>): SourceThreadReader {
  // Threads carried over from v1 import their transcripts lazily; until then the
  // full history is still in the v1 tables of the same database.
  const pendingTranscript = (threadId: string) =>
    tables.has("orchestration_v2_legacy_imports") &&
    tables.has("projection_thread_messages") &&
    Boolean(
      db
        .prepare(
          "SELECT 1 FROM orchestration_v2_legacy_imports WHERE thread_id = ? AND transcript_imported_at IS NULL",
        )
        .get(threadId),
    );
  return {
    required: {
      orchestration_v2_projection_threads: [
        "thread_id",
        "project_id",
        "deleted_at",
        "payload_json",
      ],
      orchestration_v2_projection_messages: [
        "message_id",
        "thread_id",
        "streaming",
        "created_at",
        "payload_json",
      ],
      orchestration_v2_projection_turn_items: ["thread_id", "ordinal", "type", "payload_json"],
      orchestration_v2_projection_runs: ["thread_id", "status"],
    },
    threads: (projectId) =>
      db
        .prepare(
          "SELECT * FROM orchestration_v2_projection_threads WHERE project_id = ? AND deleted_at IS NULL ORDER BY thread_id",
        )
        .all(projectId)
        .map((row) => {
          const threadId = row.thread_id as string;
          const streaming = db
            .prepare(
              "SELECT 1 FROM orchestration_v2_projection_messages WHERE thread_id = ? AND streaming = 1 LIMIT 1",
            )
            .get(threadId);
          const running = db
            .prepare(
              "SELECT 1 FROM orchestration_v2_projection_runs WHERE thread_id = ? AND status IN ('running', 'waiting') LIMIT 1",
            )
            .get(threadId);
          return {
            row,
            title: text(record(json(row.payload_json, {})).title),
            busy: Boolean(streaming || running),
          };
        }),
    read: (row) => {
      const threadId = row.thread_id as string;
      const thread = record(json(row.payload_json, {}));
      const messages: SyncMessage[] = db
        .prepare(
          "SELECT payload_json FROM orchestration_v2_projection_messages WHERE thread_id = ? ORDER BY created_at, message_id",
        )
        .all(threadId)
        .map((message) => {
          const payload = record(json(message.payload_json, {}));
          return {
            id: text(payload.id),
            role: payload.role as SyncMessage["role"],
            text: text(payload.text),
            attachments: attachments(payload.attachments),
            createdAt: text(payload.createdAt),
          };
        });
      if (pendingTranscript(threadId)) {
        const imported = new Set(messages.map((message) => message.id));
        for (const message of db
          .prepare(
            "SELECT * FROM projection_thread_messages WHERE thread_id = ? ORDER BY created_at, rowid",
          )
          .all(threadId)) {
          if (imported.has(text(message.message_id))) continue;
          messages.push({
            id: text(message.message_id),
            role: message.role as SyncMessage["role"],
            text: text(message.text),
            attachments: attachments(json(message.attachments_json, [])),
            createdAt: text(message.created_at),
          });
        }
        messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }
      const activities: SyncActivity[] = [];
      const plans: SyncMessage[] = [];
      for (const item of db
        .prepare(
          "SELECT type, payload_json FROM orchestration_v2_projection_turn_items WHERE thread_id = ? ORDER BY ordinal, turn_item_id",
        )
        .all(threadId)) {
        const type = text(item.type);
        if (V2_MESSAGE_ITEM_TYPES.has(type)) continue;
        const payload = record(json(item.payload_json, {}));
        const createdAt = text(payload.startedAt, text(payload.updatedAt));
        if (type === "proposed_plan") {
          if (payload.streaming !== true)
            plans.push(planMessage(text(payload.planId), text(payload.markdown), createdAt));
          continue;
        }
        activities.push({
          id: text(payload.id),
          tone: type === "error" || payload.status === "failed" ? "error" : "tool",
          kind: type,
          summary: text(payload.title) || type.replaceAll("_", " "),
          details: payload,
          createdAt,
        });
      }
      return {
        id: threadId,
        title: text(thread.title),
        modelSelection: modelSelection(thread.modelSelection),
        runtimeMode: runtimeMode(thread.runtimeMode),
        interactionMode: interactionMode(thread.interactionMode),
        branch: typeof thread.branch === "string" ? thread.branch : null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: withPlans(messages, plans),
        activities,
      };
    },
  };
}

async function exists(path: string): Promise<boolean> {
  return NodeFSP.access(path).then(
    () => true,
    () => false,
  );
}

/** The database a T3 home writes to: `statev2.sqlite` once it runs orchestration v2. */
export async function sourceDatabasePath(home: string): Promise<string> {
  const v2 = NodePath.join(home, "userdata/statev2.sqlite");
  return (await exists(v2)) ? v2 : NodePath.join(home, "userdata/state.sqlite");
}

/** Reads a private SQLite backup, including committed WAL pages, without migrating the source. */
export async function readSyncSource(sourceHome: string): Promise<SyncSource> {
  const expandedHome =
    sourceHome === "~"
      ? NodeOS.homedir()
      : sourceHome.startsWith("~/")
        ? NodePath.join(NodeOS.homedir(), sourceHome.slice(2))
        : sourceHome;
  if (!NodePath.isAbsolute(expandedHome))
    throw new Error("Choose an absolute T3 home path on this environment's machine.");
  const home = await NodeFSP.realpath(expandedHome);
  const filename = await sourceDatabasePath(home);
  const version = NodePath.basename(filename) === "statev2.sqlite" ? 2 : 1;
  const staging = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-snapshot-"));
  try {
    await snapshotDatabase(filename, NodePath.join(staging, "state.sqlite"));
    const db = await openReadOnlyDatabase(NodePath.join(staging, "state.sqlite"));
    try {
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => String(row.name)),
      );
      const reader = version === 2 ? v2Reader(db, tables) : v1Reader(db, tables);
      requireColumns(db, { projection_projects: PROJECT_COLUMNS, ...reader.required });
      const projectColumns = tableColumns(db, "projection_projects");
      const rows = db
        .prepare("SELECT * FROM projection_projects WHERE deleted_at IS NULL ORDER BY project_id")
        .all();
      const identity = tables.has("orchestration_events")
        ? db.prepare("SELECT event_id FROM orchestration_events ORDER BY sequence LIMIT 1").get()
        : db
            .prepare(
              "SELECT project_id, created_at FROM projection_projects ORDER BY created_at, rowid LIMIT 1",
            )
            .get();
      const projects = rows.map((row) => {
        const warnings: string[] = [];
        if (row.remote_host_json != null && row.remote_host_json !== "null") {
          warnings.push("This project uses a remote host that this fork cannot import.");
        }
        const project = decodeProject({
          id: row.project_id,
          title: row.title,
          workspaceRoot: row.workspace_root,
          repositoryIdentity: null,
          defaultModelSelection: json(row.default_model_selection_json, null),
          defaultThreadEnvMode: projectColumns.has("default_thread_env_mode")
            ? (row.default_thread_env_mode ?? null)
            : null,
          autoPull: row.auto_pull === 1,
          projectIcon: json(row.project_icon_json, null),
          scripts: json(row.scripts_json, []),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deletedAt: null,
        });
        if (warnings.length > 0) return { project, threads: [], warnings };
        const threads = reader
          .threads(project.id)
          .filter((thread) => {
            if (thread.busy)
              warnings.push(
                `${thread.title} is still receiving messages and will be retried next time.`,
              );
            return !thread.busy;
          })
          .map((thread) => decodeThread(reader.read(thread.row)));
        return { project, threads, warnings };
      });
      return {
        version,
        sourceHome: home,
        sourceId: contentHash({ home, identity }),
        contentHash: contentHash(projects),
        projects,
      };
    } finally {
      db.close();
    }
  } finally {
    await NodeFSP.rm(staging, { recursive: true, force: true });
  }
}
