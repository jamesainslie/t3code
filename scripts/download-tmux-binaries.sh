#!/usr/bin/env bash
# Download static tmux binaries for bundling with the SSH provisioner.
#
# Source: https://github.com/pythops/tmux-linux-binary
# This repo provides pre-built static tmux binaries for Linux x64 and arm64.
# Asset naming convention: tmux-linux-x86_64 / tmux-linux-arm64
# Releases track upstream tmux version tags (e.g. v3.6a).
#
# Only Linux binaries are bundled — macOS is not a common remote SSH target
# and tmux is readily available via Homebrew on macOS remotes.
set -euo pipefail

OUTPUT_DIR="${1:-dist/ssh-binaries}"
TMUX_VERSION="${TMUX_VERSION:-v3.6a}"
REPO="pythops/tmux-linux-binary"
BASE_URL="https://github.com/$REPO/releases/download/$TMUX_VERSION"

mkdir -p "$OUTPUT_DIR"

echo "Downloading static tmux binaries (version $TMUX_VERSION from $REPO)..."

# Verify the release exists before attempting downloads
if ! curl -fsS --head "$BASE_URL/tmux-linux-x86_64" -o /dev/null 2>&1; then
  echo "ERROR: Could not reach release assets at $BASE_URL" >&2
  echo "       Check that version '$TMUX_VERSION' exists in $REPO" >&2
  echo "       Available releases: https://github.com/$REPO/releases" >&2
  exit 1
fi

declare -A ASSET_MAP=(
  ["linux-x64"]="tmux-linux-x86_64"
  ["linux-arm64"]="tmux-linux-arm64"
)

for TARGET in "linux-x64" "linux-arm64"; do
  PLATFORM="${TARGET%-*}"
  ARCH="${TARGET#*-}"
  ASSET="${ASSET_MAP[$TARGET]}"
  OUT_FILE="$OUTPUT_DIR/tmux-$PLATFORM-$ARCH"
  echo "  Downloading $ASSET -> $OUT_FILE..."
  curl -fsSL "$BASE_URL/$ASSET" -o "$OUT_FILE"
  chmod +x "$OUT_FILE"
done

echo "Note: macOS tmux binaries not bundled (macOS is not a common remote SSH target)."

echo "Done. tmux binaries in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"/tmux-*
