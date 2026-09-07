// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { openReadOnlyDatabase, snapshotDatabase } from "./SqliteSnapshot.ts";

const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  createdAt: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
});
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));
const decodeRuntime = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ pid: Schema.Int })),
);
const decodeRestore = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, restoreId: Schema.String })),
);
const digest = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const backupRoot = (stateDir: string) => NodePath.join(NodePath.dirname(stateDir), "sync-recovery");

async function syncPath(path: string) {
  const handle = await NodeFSP.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function checkDatabase(path: string) {
  const db = await openReadOnlyDatabase(path);
  try {
    const checks = db.prepare("PRAGMA integrity_check").all();
    if (checks.length !== 1 || checks[0]?.integrity_check !== "ok")
      throw new Error("Recovery database integrity check failed.");
  } finally {
    db.close();
  }
}

async function filesUnder(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await NodeFSP.readdir(NodePath.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const relative = NodePath.join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Recovery cannot include a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...(await filesUnder(directory, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export async function createRecoveryBackup(stateDir: string, createdAt: string): Promise<string> {
  const id = NodeCrypto.randomUUID();
  const root = backupRoot(stateDir);
  const staging = NodePath.join(root, `${id}.staging`);
  await NodeFSP.mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await snapshotDatabase(
      NodePath.join(stateDir, "state.sqlite"),
      NodePath.join(staging, "state.sqlite"),
    );
    await checkDatabase(NodePath.join(staging, "state.sqlite"));
    for (const entry of await NodeFSP.readdir(stateDir, { withFileTypes: true })) {
      if (
        [
          "state.sqlite",
          "state.sqlite-wal",
          "state.sqlite-shm",
          "server-runtime.json",
          "logs",
          "providers",
        ].includes(entry.name)
      )
        continue;
      if (entry.isSymbolicLink())
        throw new Error(`Recovery cannot include a symbolic link: ${entry.name}`);
      await NodeFSP.cp(NodePath.join(stateDir, entry.name), NodePath.join(staging, entry.name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    const files = [];
    for (const file of await filesUnder(staging)) {
      files.push({
        path: file,
        sha256: digest(await NodeFSP.readFile(NodePath.join(staging, file))),
      });
      await syncPath(NodePath.join(staging, file));
    }
    await NodeFSP.writeFile(
      NodePath.join(staging, "manifest.json"),
      JSON.stringify({ version: 1, id, createdAt, files }),
      { mode: 0o600 },
    );
    await syncPath(NodePath.join(staging, "manifest.json"));
    await syncPath(staging);
    await NodeFSP.rename(staging, NodePath.join(root, id));
    await syncPath(root);
    // Automatic snapshots are bounded; preserved pre-restore copies are never pruned.
    if (!(await recoveryPending(stateDir))) {
      for (const old of (await listRecoveryBackups(stateDir))
        .filter((entry) => entry.id !== id)
        .slice(6))
        await NodeFSP.rm(NodePath.join(root, old.id), { recursive: true });
    }
    return id;
  } catch (cause) {
    await NodeFSP.rm(staging, { recursive: true, force: true });
    throw cause;
  }
}

export async function listRecoveryBackups(stateDir: string) {
  await NodeFSP.mkdir(backupRoot(stateDir), { recursive: true, mode: 0o700 });
  const results = [];
  for (const entry of await NodeFSP.readdir(backupRoot(stateDir))) {
    if (!/^[0-9a-f-]{36}$/.test(entry)) continue;
    const manifest = decodeManifest(
      await NodeFSP.readFile(NodePath.join(backupRoot(stateDir), entry, "manifest.json"), "utf8"),
    );
    results.push({ id: manifest.id, createdAt: manifest.createdAt });
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function verifyBackup(stateDir: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid recovery backup identifier.");
  const root = NodePath.join(backupRoot(stateDir), id);
  const manifest = decodeManifest(
    await NodeFSP.readFile(NodePath.join(root, "manifest.json"), "utf8"),
  );
  for (const file of manifest.files) {
    const path = await NodeFSP.realpath(NodePath.join(root, file.path));
    if (!path.startsWith(`${await NodeFSP.realpath(root)}${NodePath.sep}`))
      throw new Error("Recovery file is outside the backup.");
    if (digest(await NodeFSP.readFile(path)) !== file.sha256)
      throw new Error(`Recovery checksum failed: ${file.path}`);
  }
  if (!manifest.files.some((file) => file.path === "state.sqlite"))
    throw new Error("Recovery backup has no database.");
  if (manifest.id !== id) throw new Error("Recovery backup identity does not match.");
  await checkDatabase(NodePath.join(root, "state.sqlite"));
  return { root, manifest };
}

export async function recoveryPending(stateDir: string): Promise<boolean> {
  try {
    await NodeFSP.access(NodePath.join(backupRoot(stateDir), "restore-pending.json"));
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

export async function prepareRecoveryRestore(stateDir: string, id: string): Promise<void> {
  await verifyBackup(stateDir, id);
  const root = backupRoot(stateDir);
  const temp = NodePath.join(root, `${NodeCrypto.randomUUID()}.tmp`);
  await NodeFSP.writeFile(temp, JSON.stringify({ id, restoreId: NodeCrypto.randomUUID() }), {
    mode: 0o600,
    flag: "wx",
  });
  await syncPath(temp);
  await NodeFSP.rename(temp, NodePath.join(root, "restore-pending.json"));
  await syncPath(root);
}

export async function cancelRecoveryRestore(stateDir: string): Promise<void> {
  await NodeFSP.rm(NodePath.join(backupRoot(stateDir), "restore-pending.json"), { force: true });
  await syncPath(backupRoot(stateDir));
}

/** Runs before opening SQLite on startup. A preserved old directory makes an interrupted swap recoverable. */
export async function restorePendingRecovery(stateDir: string): Promise<void> {
  if (!(await recoveryPending(stateDir))) return;
  try {
    const runtime = decodeRuntime(
      await NodeFSP.readFile(NodePath.join(stateDir, "server-runtime.json"), "utf8"),
    );
    let running = true;
    try {
      process.kill(runtime.pid, 0);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") running = false;
      else throw cause;
    }
    if (running)
      throw new Error(
        "The destination server is still running. Quit it before restoring a backup.",
      );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const root = backupRoot(stateDir);
  const { id, restoreId } = decodeRestore(
    await NodeFSP.readFile(NodePath.join(root, "restore-pending.json"), "utf8"),
  );
  if (!/^[0-9a-f-]{36}$/.test(restoreId)) throw new Error("Invalid restoration identifier.");
  const verified = await verifyBackup(stateDir, id);
  const previous = NodePath.join(root, `before-restore-${restoreId}`);
  const next = NodePath.join(root, `restore-${restoreId}.staging`);
  await NodeFSP.rm(next, { recursive: true, force: true });
  await NodeFSP.mkdir(next, { recursive: true, mode: 0o700 });
  for (const file of verified.manifest.files) {
    const target = NodePath.join(next, file.path);
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    await NodeFSP.copyFile(NodePath.join(verified.root, file.path), target);
    await syncPath(target);
  }
  const current = await NodeFSP.stat(previous).then(
    () => previous,
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return stateDir;
      throw cause;
    },
  );
  for (const directory of ["providers", "logs"]) {
    try {
      await NodeFSP.cp(NodePath.join(current, directory), NodePath.join(next, directory), {
        recursive: true,
      });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  const configuration = NodePath.join(next, "project-sync.json");
  try {
    const config = JSON.parse(await NodeFSP.readFile(configuration, "utf8"));
    await NodeFSP.writeFile(configuration, JSON.stringify({ ...config, enabled: false }), {
      mode: 0o600,
    });
    await syncPath(configuration);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  try {
    await NodeFSP.access(previous);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await NodeFSP.rename(stateDir, previous);
    await syncPath(root);
    await syncPath(NodePath.dirname(stateDir));
  }
  // After an interrupted restore, only the known restoration destination is replaced.
  await NodeFSP.rm(stateDir, { recursive: true, force: true });
  await NodeFSP.rename(next, stateDir);
  await syncPath(NodePath.dirname(stateDir));
  await NodeFSP.rm(NodePath.join(root, "restore-pending.json"));
  await syncPath(root);
}
