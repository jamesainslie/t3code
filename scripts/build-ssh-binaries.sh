#!/usr/bin/env bash
# Build standalone t3 server binaries and bundle vendored tmux for remote SSH
# provisioning. These are deployed to remote machines via SCP.
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

# Copy vendored tmux binaries (paths relative to repo root, where this script is invoked)
TMUX_VENDOR_DIR="vendor/tmux-binaries"
echo ""
echo "Bundling vendored tmux binaries..."
for TARGET in "linux-x64" "linux-arm64"; do
  SRC="$TMUX_VENDOR_DIR/tmux-$TARGET"
  DEST="$OUTPUT_DIR/tmux-$TARGET"
  if [ ! -f "$SRC" ]; then
    echo "  WARNING: vendored tmux binary not found: $SRC" >&2
    echo "           Run: bash scripts/download-tmux-binaries.sh vendor/tmux-binaries" >&2
    continue
  fi
  cp "$SRC" "$DEST"
  chmod +x "$DEST"
  echo "  Copied $SRC -> $DEST"
done

echo ""
echo "Done. All binaries in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"/*
