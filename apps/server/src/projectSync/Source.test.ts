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
      kind: "sync.history",
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
