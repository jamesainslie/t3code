// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { OrchestrationProject, OrchestrationThread } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { openReadOnlyDatabase, snapshotDatabase } from "./SqliteSnapshot.ts";

export const SyncSource = Schema.Struct({
  version: Schema.Literal(1),
  sourceHome: Schema.String,
  sourceId: Schema.String,
  contentHash: Schema.String,
  projects: Schema.Array(
    Schema.Struct({
      project: OrchestrationProject,
      threads: Schema.Array(OrchestrationThread),
      warnings: Schema.Array(Schema.String),
    }),
  ),
});
export type SyncSource = typeof SyncSource.Type;

export function contentHash(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const decodeProject = Schema.decodeUnknownSync(OrchestrationProject);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const json = (value: unknown, fallback: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : fallback;

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
  const filename = NodePath.join(home, "userdata/state.sqlite");
  const staging = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-snapshot-"));
  try {
    await snapshotDatabase(filename, NodePath.join(staging, "state.sqlite"));
    const db = await openReadOnlyDatabase(NodePath.join(staging, "state.sqlite"));
    try {
      for (const [table, required] of Object.entries({
        projection_projects: [
          "project_id",
          "title",
          "workspace_root",
          "scripts_json",
          "created_at",
          "updated_at",
          "deleted_at",
          "default_model_selection_json",
        ],
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
      })) {
        const columns = new Set(
          db
            .prepare("SELECT name FROM pragma_table_info(?)")
            .all(table)
            .map((row) => row.name),
        );
        for (const column of required) {
          if (!columns.has(column))
            throw new Error(`Unsupported source schema: ${table}.${column} is missing`);
        }
      }
      const rows = db
        .prepare("SELECT * FROM projection_projects WHERE deleted_at IS NULL ORDER BY project_id")
        .all();
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name),
      );
      const hasEvents = db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'orchestration_events'")
        .get();
      const identity = hasEvents
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
          defaultModelSelection: json(row.default_model_selection_json, null),
          defaultThreadEnvMode: row.default_thread_env_mode ?? null,
          autoPull: row.auto_pull === 1,
          projectIcon: json(row.project_icon_json, null),
          scripts: json(row.scripts_json, []),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deletedAt: null,
        });
        if (warnings.length > 0) return { project, threads: [], warnings };
        const threads = db
          .prepare(
            "SELECT * FROM projection_threads WHERE project_id = ? AND deleted_at IS NULL ORDER BY thread_id",
          )
          .all(project.id)
          .filter((thread) => {
            const streaming = db
              .prepare(
                "SELECT 1 FROM projection_thread_messages WHERE thread_id = ? AND is_streaming = 1 LIMIT 1",
              )
              .get(thread.thread_id!);
            const running =
              tables.has("projection_turns") &&
              db
                .prepare(
                  "SELECT 1 FROM projection_turns WHERE thread_id = ? AND state IN ('pending', 'running') LIMIT 1",
                )
                .get(thread.thread_id!);
            if (streaming || running)
              warnings.push(
                `${thread.title} is still receiving messages and will be retried next time.`,
              );
            return !streaming && !running;
          })
          .map((thread) => {
            const messages = db
              .prepare(
                "SELECT * FROM projection_thread_messages WHERE thread_id = ? ORDER BY created_at, rowid",
              )
              .all(thread.thread_id!)
              .map((message) => ({
                id: message.message_id,
                role: message.role,
                text: message.text,
                attachments: json(message.attachments_json, []),
                turnId: null,
                streaming: false,
                createdAt: message.created_at,
                updatedAt: message.updated_at,
              }));
            const activities = tables.has("projection_thread_activities")
              ? db
                  .prepare(
                    "SELECT * FROM projection_thread_activities WHERE thread_id = ? ORDER BY created_at, rowid",
                  )
                  .all(thread.thread_id!)
                  .map((activity, index) => ({
                    id: activity.activity_id,
                    kind: "sync.history",
                    tone: activity.tone === "approval" ? "info" : activity.tone,
                    summary: activity.summary,
                    payload: {
                      originalKind: activity.kind,
                      details: json(activity.payload_json, null),
                    },
                    turnId: null,
                    sequence: index,
                    createdAt: activity.created_at,
                  }))
              : [];
            if (tables.has("projection_thread_proposed_plans")) {
              for (const plan of db
                .prepare(
                  "SELECT * FROM projection_thread_proposed_plans WHERE thread_id = ? ORDER BY created_at, rowid",
                )
                .all(thread.thread_id!)) {
                messages.push({
                  id: `historical-plan-${plan.plan_id}`,
                  role: "system",
                  text: `Historical proposed plan:\n\n${plan.plan_markdown}`,
                  attachments: [],
                  turnId: null,
                  streaming: false,
                  createdAt: plan.created_at,
                  updatedAt: plan.updated_at ?? plan.created_at,
                });
              }
              messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
            }
            return decodeThread({
              id: thread.thread_id,
              projectId: project.id,
              title: thread.title,
              modelSelection: json(thread.model_selection_json, null),
              runtimeMode: thread.runtime_mode,
              interactionMode: thread.interaction_mode,
              branch: thread.branch,
              worktreePath: thread.worktree_path,
              createdAt: thread.created_at,
              updatedAt: thread.updated_at,
              archivedAt: thread.archived_at ?? null,
              deletedAt: null,
              latestTurn: null,
              session: null,
              messages,
              activities,
              checkpoints: [],
            });
          });
        return { project, threads, warnings };
      });
      return {
        version: 1,
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
