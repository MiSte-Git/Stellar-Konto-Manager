#!/usr/bin/env bash
set -euo pipefail

# start-build.sh
# Löscht den Inhalt von frontend/dist und baut das Frontend neu.

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
DIST_DIR="$FRONTEND_DIR/dist"

# Optional .env einlesen (für I18N_* Variablen)
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
  set +a
fi

: "${I18N_AUTO_SYNC:=1}"
: "${I18N_ENFORCE:=1}"
: "${I18N_PY_SYNC:=}"
: "${BASE_REF:=origin/main}"
: "${I18N_ENFORCE_FORCE:=0}"

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Fehler: Frontend-Verzeichnis nicht gefunden: $FRONTEND_DIR" >&2
  exit 1
fi

# Optional: i18n Auto-Sync + Ack (vor Build)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DE_CHANGES=$(git status --porcelain -- frontend/src/locales/de 2>/dev/null | wc -l | tr -d ' ')
else
  DE_CHANGES=0
fi

if [[ "$I18N_AUTO_SYNC" == "1" ]]; then
  if [[ -n "$I18N_PY_SYNC" && -f "$I18N_PY_SYNC" && "$DE_CHANGES" != "0" ]]; then
    echo "🧩 i18n: Python-Sync (DE verändert) → $I18N_PY_SYNC"
    python3 "$I18N_PY_SYNC" || python "$I18N_PY_SYNC"
  else
    echo "ℹ️ i18n: Kein Python-Sync nötig (kein Skript oder keine DE-Änderungen)"
  fi

  echo "📝 i18n: Update EN-Acks (nur betroffene Keys)…"
  (cd "$FRONTEND_DIR" && BASE_REF="$BASE_REF" npm run i18n:ack)
fi

# Optional: Strikte Checks (nur wenn DE verändert oder FORCIERT)
if [[ "$I18N_ENFORCE" == "1" && ( "$DE_CHANGES" != "0" || "$I18N_ENFORCE_FORCE" == "1" ) ]]; then
  echo "🔎 i18n: Phase-1 Stale-Check…"
  (cd "$ROOT_DIR" && BASE_REF="$BASE_REF" node scripts/i18n_stale_check.mjs)
  echo "🔒 i18n: Phase-2 Review-Ack…"
  (cd "$ROOT_DIR" && BASE_REF="$BASE_REF" node scripts/i18n_phase2_ack.mjs)
else
  echo "ℹ️ i18n: Checks übersprungen (keine DE-Änderungen erkannt oder I18N_ENFORCE=0)"
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
