// @effect-diagnostics nodeBuiltinImport:off
type SqliteValue = string | number | bigint | Uint8Array | null;
type SqliteRow = Record<string, SqliteValue>;

/** The source boundary only exposes reads; neither runtime can migrate or update it. */
export async function openReadOnlyDatabase(filename: string) {
  if (process.versions.bun !== undefined) {
    const BunSqlite = await import("bun:sqlite");
    const db = new BunSqlite.Database(filename, { readonly: true });
    return {
      prepare: (query: string) => {
        const statement = db.query<SqliteRow, SqliteValue[]>(query);
        return {
          all: (...values: SqliteValue[]) => statement.all(...values),
          get: (...values: SqliteValue[]) => statement.get(...values) ?? undefined,
        };
      },
      close: () => db.close(),
    };
  }
  const NodeSqlite = await import("node:sqlite");
  return new NodeSqlite.DatabaseSync(filename, { readOnly: true });
}

/** Both operations include committed WAL pages and write only the private destination. */
export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  if (process.versions.bun !== undefined) {
    const BunSqlite = await import("bun:sqlite");
    const db = new BunSqlite.Database(source, { readonly: true });
    try {
      db.run("VACUUM INTO ?", [destination]);
    } finally {
      db.close();
    }
  } else {
    const NodeSqlite = await import("node:sqlite");
    const db = new NodeSqlite.DatabaseSync(source, { readOnly: true });
    try {
      await NodeSqlite.backup(db, destination);
    } finally {
      db.close();
    }
  }
}
