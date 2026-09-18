// @effect-diagnostics nodeBuiltinImport:off

/** The source boundary only exposes reads; nothing here can migrate or update it. */
export async function openReadOnlyDatabase(filename: string) {
  const NodeSqlite = await import("node:sqlite");
  return new NodeSqlite.DatabaseSync(filename, { readOnly: true });
}

/**
 * Copies a database that another connection in this process may hold open,
 * including committed WAL pages, into a private destination file. `VACUUM
 * INTO` runs synchronously on the read-only connection: `node:sqlite`'s async
 * `backup()` only settles when something else wakes the event loop, so an
 * otherwise idle Effect fiber awaiting it hangs.
 */
export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const db = await openReadOnlyDatabase(source);
  try {
    db.prepare("VACUUM INTO ?").run(destination);
  } finally {
    db.close();
  }
}
