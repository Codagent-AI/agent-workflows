#!/usr/bin/env bash
# Copies the pages that belong on codagent.dev from a docs folder into a destination folder.
# Usage: scripts/sync-docs.sh <source-docs-dir> <destination-dir>
# The destination is emptied first. Pages that stay in the repository are dropped, and only the
# images the copied pages reference are copied.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <source-docs-dir> <destination-dir>" >&2
  exit 2
fi

SRC="$1"
DEST="$2"
UNSYNCED=(README.md AGENTS.md CLAUDE.md development.md coming-from-agent-runner.md)

if [ ! -d "$SRC" ]; then
  echo "source folder not found: $SRC" >&2
  exit 1
fi
# Never empty the source, or a folder that holds it.
SRC_REAL="$(cd "$SRC" && pwd -P)"
mkdir -p "$DEST"
DEST_REAL="$(cd "$DEST" && pwd -P)"
case "$SRC_REAL/" in
  "$DEST_REAL"/*) echo "destination must not contain the source" >&2; exit 1 ;;
esac
case "$DEST_REAL/" in
  "$SRC_REAL"/*) echo "destination must not be inside the source" >&2; exit 1 ;;
esac

find "$DEST_REAL" -mindepth 1 -delete

cp "$SRC_REAL"/*.md "$DEST_REAL"/
for page in "${UNSYNCED[@]}"; do
  rm -f "$DEST_REAL/$page"
done

# Copy only the images the copied pages reference, so the repo logo or a demo GIF never ships.
if [ -d "$SRC_REAL/images" ]; then
  mkdir -p "$DEST_REAL/images"
  for img in "$SRC_REAL"/images/*; do
    [ -f "$img" ] || continue
    base="$(basename "$img")"
    if grep -qlF "images/$base" "$DEST_REAL"/*.md 2>/dev/null; then
      cp "$img" "$DEST_REAL/images/$base"
    fi
  done
  # Downscale oversized rasters when ImageMagick is installed.
  if command -v convert >/dev/null 2>&1; then
    for img in "$DEST_REAL"/images/*.png "$DEST_REAL"/images/*.jpg "$DEST_REAL"/images/*.jpeg; do
      [ -f "$img" ] || continue
      convert "$img" -resize '1280x1280>' "$img" || true
    done
  fi
  rmdir "$DEST_REAL/images" 2>/dev/null || true
fi

echo "synced $(find "$DEST_REAL" -type f | wc -l | tr -d ' ') files into $DEST"
