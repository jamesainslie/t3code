#!/usr/bin/env bash
# Build standalone t3 server binaries for remote SSH provisioning.
# These are Bun-compiled binaries deployed to remote machines via SCP.
#
# The compiled binary always uses Bun's SQLite driver (@effect/sql-sqlite-bun).
# NodeSqliteClient.ts imports node:sqlite which doesn't exist in Bun, so we
# temporarily stub it out during compilation to prevent the bundler from
# including it.
set -euo pipefail

OUTPUT_DIR="${1:-dist/ssh-binaries}"
mkdir -p "$OUTPUT_DIR"

NODE_SQLITE_CLIENT="apps/server/src/persistence/NodeSqliteClient.ts"
NODE_SQLITE_BACKUP="${NODE_SQLITE_CLIENT}.bak"

# Stub out NodeSqliteClient to prevent node:sqlite from being bundled
cp "$NODE_SQLITE_CLIENT" "$NODE_SQLITE_BACKUP"
cat > "$NODE_SQLITE_CLIENT" << 'STUB'
// Stub for Bun-compiled binaries — node:sqlite is not available in Bun.
// The real file is restored after compilation. See scripts/build-ssh-binaries.sh.
export const layer = () => { throw new Error("node:sqlite is not available in Bun-compiled binaries"); };
export const SqliteClient = null;
STUB

restore_node_sqlite() {
  mv "$NODE_SQLITE_BACKUP" "$NODE_SQLITE_CLIENT"
}
trap restore_node_sqlite EXIT

echo "Building standalone t3 server binaries..."

for TARGET in "linux-x64" "linux-arm64" "darwin-x64" "darwin-arm64"; do
  PLATFORM="${TARGET%-*}"
  ARCH="${TARGET#*-}"
  OUT_FILE="$OUTPUT_DIR/t3-server-$PLATFORM-$ARCH"
  echo "  Building $OUT_FILE (bun-$TARGET)..."
  bun build apps/server/src/bin.ts \
    --compile \
    --target="bun-$TARGET" \
    --outfile "$OUT_FILE"
  chmod +x "$OUT_FILE"
done

echo "Done. Binaries in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"/t3-server-*
