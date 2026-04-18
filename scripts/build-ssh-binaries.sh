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

# Build matrix: each entry is a Bun compile target paired with the filename
# slug used by apps/desktop/src/sshManager.ts. Linux builds ship both glibc
# and musl variants so Alpine/Void-based remotes can run the server too.
# The glibc Linux builds keep their historical unsuffixed names.
#
# Bun does NOT currently support bun-windows-arm64, bun-freebsd-x64, or
# bun-freebsd-arm64, so Windows/FreeBSD remotes are not yet provisionable.
# See https://github.com/oven-sh/bun/issues/1361 (FreeBSD) for upstream status.
BUILD_TARGETS=(
  "linux-x64:t3-server-linux-x64"
  "linux-arm64:t3-server-linux-arm64"
  "linux-x64-musl:t3-server-linux-x64-musl"
  "linux-arm64-musl:t3-server-linux-arm64-musl"
  "darwin-x64:t3-server-darwin-x64"
  "darwin-arm64:t3-server-darwin-arm64"
)

for ENTRY in "${BUILD_TARGETS[@]}"; do
  TARGET="${ENTRY%%:*}"
  FILENAME="${ENTRY##*:}"
  OUT_FILE="$OUTPUT_DIR/$FILENAME"
  echo "  Building $OUT_FILE (bun-$TARGET)..."
  bun build apps/server/src/bin.ts \
    --compile \
    --target="bun-$TARGET" \
    --outfile "$OUT_FILE"
  chmod +x "$OUT_FILE"
done

# Copy vendored tmux binaries (paths relative to repo root, where this script is invoked).
# If the vendored binaries are missing (e.g. fresh checkout, release CI runner),
# invoke the download script automatically so desktop packaging never ships a
# build with a partial ssh-binaries directory.
TMUX_VENDOR_DIR="vendor/tmux-binaries"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "Bundling vendored tmux binaries..."
if [ ! -f "$TMUX_VENDOR_DIR/tmux-linux-x64" ] || [ ! -f "$TMUX_VENDOR_DIR/tmux-linux-arm64" ]; then
  echo "  Vendored tmux binaries missing — running download-tmux-binaries.sh..."
  bash "$SCRIPT_DIR/download-tmux-binaries.sh" "$TMUX_VENDOR_DIR"
fi
for TARGET in "linux-x64" "linux-arm64"; do
  SRC="$TMUX_VENDOR_DIR/tmux-$TARGET"
  DEST="$OUTPUT_DIR/tmux-$TARGET"
  if [ ! -f "$SRC" ]; then
    echo "  ERROR: vendored tmux binary still not present after download: $SRC" >&2
    echo "         Check network/proxy and retry: bash scripts/download-tmux-binaries.sh $TMUX_VENDOR_DIR" >&2
    exit 1
  fi
  cp "$SRC" "$DEST"
  chmod +x "$DEST"
  echo "  Copied $SRC -> $DEST"
done

echo ""
echo "Done. All binaries in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"/*
