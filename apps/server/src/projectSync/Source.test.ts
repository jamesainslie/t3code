// @effect-diagnostics nodeBuiltinImport:off
import * as NodeSqlite from "node:sqlite";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { readSyncSource } from "./Source.ts";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => NodeFSP.rm(home, { recursive: true, force: true })),
  );
});

async function fixture() {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-source-"));
  homes.push(home);
  await NodeFSP.mkdir(NodePath.join(home, "userdata"));
  const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata/state.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE projection_projects (project_id TEXT, title TEXT, workspace_root TEXT,
      scripts_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      default_model_selection_json TEXT, remote_host_json TEXT);
    CREATE TABLE projection_threads (thread_id TEXT, project_id TEXT, title TEXT,
      model_selection_json TEXT, runtime_mode TEXT, interaction_mode TEXT, branch TEXT,
      worktree_path TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE projection_thread_messages (message_id TEXT, thread_id TEXT, role TEXT,
      text TEXT, is_streaming INTEGER, created_at TEXT, updated_at TEXT, attachments_json TEXT);
    INSERT INTO projection_projects VALUES (
      'p1', 'Example', '/work/example', '[]', '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z', NULL, NULL, NULL);
    INSERT INTO projection_threads VALUES (
      't1', 'p1', 'Existing conversation', '{"instanceId":"codex","model":"gpt-5"}',
      'full-access', 'default', NULL, NULL, '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z', NULL);
    INSERT INTO projection_thread_messages VALUES (
      'm1', 't1', 'user', 'A preserved question', 0, '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z', NULL);
  `);
  return { home, db };
}

it("reads committed WAL history without changing the main install", async () => {
  const { home, db } = await fixture();
  try {
    const before = db.prepare("SELECT * FROM projection_thread_messages").all();
    const source = await readSyncSource(home);
    expect(source.version).toBe(1);
    expect(source.projects[0]?.project.title).toBe("Example");
    expect(source.projects[0]?.threads[0]?.messages[0]?.text).toBe("A preserved question");
    expect(db.prepare("SELECT * FROM projection_thread_messages").all()).toEqual(before);
    expect((await readSyncSource(home)).contentHash).toBe(source.contentHash);
  } finally {
    db.close();
  }
});

it("defers a conversation while its answer is still streaming", async () => {
  const { home, db } = await fixture();
  try {
    db.exec("UPDATE projection_thread_messages SET is_streaming = 1");
    const source = await readSyncSource(home);
    expect(source.projects[0]?.threads).toEqual([]);
    expect(source.projects[0]?.warnings).toContain(
      "Existing conversation is still receiving messages and will be retried next time.",
    );
  } finally {
    db.close();
  }
});

it("rejects an incompatible required schema instead of substituting defaults", async () => {
  const { home, db } = await fixture();
  db.exec("ALTER TABLE projection_threads DROP COLUMN model_selection_json");
  db.close();
  await expect(readSyncSource(home)).rejects.toThrow(
    "Unsupported source schema: projection_threads.model_selection_json is missing",
  );
});

it("skips remote histories and detects replacement of a source at the same path", async () => {
  const { home, db } = await fixture();
  try {
    const before = await readSyncSource(home);
    db.exec("UPDATE projection_projects SET remote_host_json = '{}' ");
    expect((await readSyncSource(home)).projects[0]?.threads).toEqual([]);
    db.exec("UPDATE projection_projects SET project_id = 'replacement'");
    expect((await readSyncSource(home)).sourceId).not.toBe(before.sourceId);
  } finally {
    db.close();
  }
});

it("preserves historical tools and plans without creating actionable approvals", async () => {
  const { home, db } = await fixture();
  try {
    db.exec(`CREATE TABLE projection_thread_activities (activity_id TEXT, thread_id TEXT, tone TEXT, kind TEXT, summary TEXT, payload_json TEXT, created_at TEXT);
      INSERT INTO projection_thread_activities VALUES ('a1','t1','approval','approval.requested','Requested shell access','{"requestId":"old"}','2026-09-01T00:00:00Z');
      CREATE TABLE projection_thread_proposed_plans (plan_id TEXT, thread_id TEXT, plan_markdown TEXT, created_at TEXT);
      INSERT INTO projection_thread_proposed_plans VALUES ('plan1','t1','The original plan','2026-09-01T00:00:00Z');`);
    const thread = (await readSyncSource(home)).projects[0]!.threads[0]!;
    expect(thread.activities[0]).toMatchObject({
      kind: "approval.requested",
      tone: "info",
      summary: "Requested shell access",
    });
    expect(thread.messages.some((message) => message.text.includes("The original plan"))).toBe(
      true,
    );
  } finally {
    db.close();
  }
});

async function v2Fixture() {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-source-v2-"));
  homes.push(home);
  await NodeFSP.mkdir(NodePath.join(home, "userdata"));
  // A v1 database beside it is ignored once the install has moved to v2.
  new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata/state.sqlite")).close();
  const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata/statev2.sqlite"));
  const thread = (id: string, title: string) =>
    JSON.stringify({
      id,
      projectId: "p1",
      title,
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "plan",
      branch: "main",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  const message = (id: string, threadId: string, role: string, text: string, createdAt: string) =>
    JSON.stringify({ id, threadId, role, text, attachments: [], createdAt });
  db.exec(`
    CREATE TABLE projection_projects (project_id TEXT, title TEXT, workspace_root TEXT,
      scripts_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      default_model_selection_json TEXT);
    CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, project_id TEXT,
      deleted_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_messages (message_id TEXT, thread_id TEXT,
      streaming INTEGER, created_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT, thread_id TEXT,
      ordinal INTEGER, type TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runs (thread_id TEXT, status TEXT);
    CREATE TABLE orchestration_v2_legacy_imports (thread_id TEXT, transcript_imported_at TEXT);
    CREATE TABLE projection_thread_messages (message_id TEXT, thread_id TEXT, role TEXT,
      text TEXT, attachments_json TEXT, created_at TEXT);
    INSERT INTO projection_projects VALUES ('p1', 'Example', '/work/example', '[]',
      '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', NULL, NULL);
  `);
  const insertThread = db.prepare(
    "INSERT INTO orchestration_v2_projection_threads VALUES (?, 'p1', NULL, ?)",
  );
  insertThread.run("t-v2", thread("t-v2", "A v2 conversation"));
  insertThread.run("t-imported", thread("t-imported", "Carried over from v1"));
  const insertMessage = db.prepare(
    "INSERT INTO orchestration_v2_projection_messages VALUES (?, ?, 0, ?, ?)",
  );
  insertMessage.run(
    "m1",
    "t-v2",
    "2026-09-01T00:00:01.000Z",
    message("m1", "t-v2", "user", "A v2 question", "2026-09-01T00:00:01.000Z"),
  );
  insertMessage.run(
    "m2",
    "t-v2",
    "2026-09-01T00:00:03.000Z",
    message("m2", "t-v2", "assistant", "A v2 answer", "2026-09-01T00:00:03.000Z"),
  );
  // The importer copied only the latest message; the rest waits in the v1 tables.
  insertMessage.run(
    "old-2",
    "t-imported",
    "2026-08-01T00:00:02.000Z",
    message("old-2", "t-imported", "assistant", "Old answer", "2026-08-01T00:00:02.000Z"),
  );
  db.exec(`
    INSERT INTO orchestration_v2_legacy_imports VALUES ('t-imported', NULL);
    INSERT INTO projection_thread_messages VALUES
      ('old-1', 't-imported', 'user', 'Old question', '[]', '2026-08-01T00:00:01.000Z'),
      ('old-2', 't-imported', 'assistant', 'Old answer', '[]', '2026-08-01T00:00:02.000Z');
  `);
  const insertItem = db.prepare(
    "INSERT INTO orchestration_v2_projection_turn_items VALUES (?, 't-v2', ?, ?, ?)",
  );
  insertItem.run(
    "i1",
    1,
    "user_message",
    JSON.stringify({ id: "i1", type: "user_message", status: "completed" }),
  );
  insertItem.run(
    "i2",
    2,
    "command_execution",
    JSON.stringify({
      id: "i2",
      type: "command_execution",
      status: "failed",
      title: "vp test",
      startedAt: "2026-09-01T00:00:02.000Z",
    }),
  );
  insertItem.run(
    "i3",
    3,
    "proposed_plan",
    JSON.stringify({
      id: "i3",
      type: "proposed_plan",
      planId: "plan-1",
      markdown: "The plan",
      streaming: false,
      startedAt: "2026-09-01T00:00:02.500Z",
    }),
  );
  return { home, db };
}

it("reads an install already on orchestration v2, with its tools, plans and lazy transcripts", async () => {
  const { home, db } = await v2Fixture();
  try {
    const source = await readSyncSource(home);
    expect(source.version).toBe(2);
    const [imported, current] = source.projects[0]!.threads;
    expect(current).toMatchObject({
      title: "A v2 conversation",
      interactionMode: "plan",
      branch: "main",
    });
    expect(current!.messages.map((message) => message.text)).toEqual([
      "A v2 question",
      "Historical proposed plan:\n\nThe plan",
      "A v2 answer",
    ]);
    expect(current!.activities).toMatchObject([
      { kind: "command_execution", tone: "error", summary: "vp test" },
    ]);
    expect(imported!.messages.map((message) => message.text)).toEqual([
      "Old question",
      "Old answer",
    ]);
  } finally {
    db.close();
  }
});

it("defers a v2 conversation while a run is still working", async () => {
  const { home, db } = await v2Fixture();
  try {
    db.exec("INSERT INTO orchestration_v2_projection_runs VALUES ('t-v2', 'running')");
    const entry = (await readSyncSource(home)).projects[0]!;
    expect(entry.threads.map((thread) => thread.id)).toEqual(["t-imported"]);
    expect(entry.warnings).toContain(
      "A v2 conversation is still receiving messages and will be retried next time.",
    );
  } finally {
    db.close();
  }
});
