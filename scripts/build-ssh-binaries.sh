#!/usr/bin/env bash
# Build standalone t3 server binaries for remote SSH provisioning.
# These are deployed to remote machines by the local client during provisioning.
set -euo pipefail

OUTPUT_DIR="${1:-dist/ssh-binaries}"
mkdir -p "$OUTPUT_DIR"

echo "Building standalone t3 server binaries..."

# Bun cross-compilation targets (all supported as of Bun 1.x):
#   bun-linux-x64, bun-linux-arm64, bun-darwin-x64, bun-darwin-arm64
# Windows targets are excluded — Windows is not a supported remote SSH target.
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
