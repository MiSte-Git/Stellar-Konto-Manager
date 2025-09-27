#!/usr/bin/env bash
set -euo pipefail

# start-build.sh
# Löscht den Inhalt von frontend/dist und baut das Frontend neu.

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
DIST_DIR="$FRONTEND_DIR/dist"

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Fehler: Frontend-Verzeichnis nicht gefunden: $FRONTEND_DIR" >&2
  exit 1
fi

# Ordner-Inhalt von dist sicher löschen (Ordner selbst beibehalten)
if [[ -d "$DIST_DIR" ]]; then
  echo "Leere bestehenden Build-Output: $DIST_DIR"
  # Löscht nur Inhalte; vermeidet versehentliches Entfernen von '.'/'..'
  find "$DIST_DIR" -mindepth 1 -delete
fi

echo "Baue Frontend (npm run build) …"
cd "$FRONTEND_DIR"
npm run build
