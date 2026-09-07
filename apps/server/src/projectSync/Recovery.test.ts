// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { expect, it } from "vite-plus/test";
import {
  cancelRecoveryRestore,
  createRecoveryBackup,
  prepareRecoveryRestore,
  recoveryPending,
  restorePendingRecovery,
} from "./Recovery.ts";

it("restores database, files, and settings while preserving the pre-restore state", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-recovery-"));
  const state = NodePath.join(root, "userdata");
  await NodeFSP.mkdir(NodePath.join(state, "attachments"), { recursive: true });
  try {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(state, "state.sqlite"));
    db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('before')");
    await NodeFSP.writeFile(NodePath.join(state, "attachments/a.txt"), "before");
    await NodeFSP.writeFile(
      NodePath.join(state, "project-sync.json"),
      JSON.stringify({ enabled: true }),
    );
    const id = await createRecoveryBackup(state, "2026-09-07T00:00:00Z");
    db.exec("UPDATE example SET value = 'after'");
    db.close();
    await NodeFSP.writeFile(NodePath.join(state, "attachments/a.txt"), "after");
    await prepareRecoveryRestore(state, id);
    await NodeFSP.writeFile(
      NodePath.join(state, "server-runtime.json"),
      JSON.stringify({ pid: process.pid }),
    );
    await expect(restorePendingRecovery(state)).rejects.toThrow("running");
    await NodeFSP.unlink(NodePath.join(state, "server-runtime.json"));
    await restorePendingRecovery(state);
    expect(await recoveryPending(state)).toBe(false);
    expect(await NodeFSP.readFile(NodePath.join(state, "attachments/a.txt"), "utf8")).toBe(
      "before",
    );
    expect(
      JSON.parse(await NodeFSP.readFile(NodePath.join(state, "project-sync.json"), "utf8")).enabled,
    ).toBe(false);
    const restored = new NodeSqlite.DatabaseSync(NodePath.join(state, "state.sqlite"), {
      readOnly: true,
    });
    try {
      expect(restored.prepare("SELECT value FROM example").get()?.value).toBe("before");
    } finally {
      restored.close();
    }
    const retained = (await NodeFSP.readdir(NodePath.join(root, "sync-recovery"))).find((name) =>
      name.startsWith("before-restore-"),
    )!;
    expect(
      await NodeFSP.readFile(
        NodePath.join(root, "sync-recovery", retained, "attachments/a.txt"),
        "utf8",
      ),
    ).toBe("after");
    await prepareRecoveryRestore(state, id);
    await cancelRecoveryRestore(state);
    expect(await recoveryPending(state)).toBe(false);
    await prepareRecoveryRestore(state, id);
    await restorePendingRecovery(state);
    expect(
      (await NodeFSP.readdir(NodePath.join(root, "sync-recovery"))).filter((name) =>
        name.startsWith("before-restore-"),
      ),
    ).toHaveLength(2);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("refuses a corrupted backup before scheduling restoration", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-recovery-"));
  const state = NodePath.join(root, "userdata");
  await NodeFSP.mkdir(state);
  try {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(state, "state.sqlite"));
    db.exec("CREATE TABLE example (value TEXT)");
    db.close();
    const id = await createRecoveryBackup(state, "2026-09-07T00:00:00Z");
    await NodeFSP.appendFile(
      NodePath.join(root, "sync-recovery", id, "state.sqlite"),
      "corruption",
    );
    await expect(prepareRecoveryRestore(state, id)).rejects.toThrow("checksum");
    expect(await recoveryPending(state)).toBe(false);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("finishes an interrupted directory swap and preserves provider files", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-interrupted-"));
  const state = NodePath.join(root, "userdata");
  await NodeFSP.mkdir(NodePath.join(state, "providers"), { recursive: true });
  try {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(state, "state.sqlite"));
    db.exec("CREATE TABLE example (value TEXT)");
    db.close();
    await NodeFSP.writeFile(NodePath.join(state, "providers/session"), "keep me");
    const id = await createRecoveryBackup(state, "2026-09-07T00:00:00Z");
    await prepareRecoveryRestore(state, id);
    const marker = JSON.parse(
      await NodeFSP.readFile(NodePath.join(root, "sync-recovery/restore-pending.json"), "utf8"),
    );
    await NodeFSP.rename(
      state,
      NodePath.join(root, `sync-recovery/before-restore-${marker.restoreId}`),
    );
    await restorePendingRecovery(state);
    expect(await NodeFSP.readFile(NodePath.join(state, "providers/session"), "utf8")).toBe(
      "keep me",
    );
    expect(await recoveryPending(state)).toBe(false);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
