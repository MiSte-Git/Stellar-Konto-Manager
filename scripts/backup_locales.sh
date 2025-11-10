#!/usr/bin/env bash
set -euo pipefail

# Weekly backup of locales into /content_backups with tags
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT_DIR/frontend/src/locales"
DST="$ROOT_DIR/content_backups"
DATE_TAG="$(date +%Y%m%d)"

mkdir -p "$DST"

# Determine versions (manual: update VERSION files per namespace if needed)
LEARN_VER="v1.0"
GLOSSARY_VER="v0.9"

TAR_NAME="locales_${DATE_TAG}.tar.gz"

# Create a versioned directory snapshot
SNAP_DIR="$DST/snapshot_${DATE_TAG}"
rm -rf "$SNAP_DIR"
mkdir -p "$SNAP_DIR"

cp -R "$SRC" "$SNAP_DIR/"

tar -czf "$DST/$TAR_NAME" -C "$SNAP_DIR" locales

echo "Backup created: $DST/$TAR_NAME"
echo "Tags: learn-$LEARN_VER, glossary-$GLOSSARY_VER"
