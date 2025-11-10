#!/bin/bash

# Farben für schöne Log-Ausgabe
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Projektverzeichnisse setzen
PROJECT_DIR=$(pwd)
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"

# .env-Datei einlesen, falls vorhanden
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
  echo -e "${BLUE}🌍 .env-Datei geladen${NC}"
else
  echo -e "${YELLOW}⚠️ Keine .env-Datei gefunden – Standardwerte werden verwendet${NC}"
  BACKEND_PORT=3000
  FRONTEND_PORT=5173
fi

# Defaults setzen, falls nicht in .env definiert
: "${BACKEND_PORT:=3000}"
: "${FRONTEND_PORT:=5173}"
: "${I18N_AUTO_SYNC:=0}"
: "${I18N_PY_SYNC:=}"
: "${BASE_REF:=origin/main}"

# Optional: i18n Auto-Sync + Ack
if [ "$I18N_AUTO_SYNC" = "1" ]; then
  echo -e "${BLUE}🔤 i18n Auto-Sync aktiviert${NC}"
  # Prüfen, ob DE-Locales geändert wurden (Working Tree)
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    DE_CHANGES=$(git status --porcelain -- frontend/src/locales/de 2>/dev/null | wc -l | tr -d ' ')
  else
    DE_CHANGES=0
  fi

  # 1) Python-Sync (nur wenn DE geändert und Skript vorhanden)
  if [ -n "$I18N_PY_SYNC" ] && [ -f "$I18N_PY_SYNC" ]; then
    if [ "$DE_CHANGES" != "0" ]; then
      echo -e "${BLUE}🧩 Führe Python-Sync aus: $I18N_PY_SYNC${NC}"
      python3 "$I18N_PY_SYNC" || python "$I18N_PY_SYNC"
    else
      echo -e "${BLUE}✅ Keine DE-Änderungen erkannt – überspringe Python-Sync${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️ I18N_PY_SYNC nicht gesetzt/gefunden – überspringe Python-Sync${NC}"
  fi

  # 2) Ack-Update (immer; NOP wenn nichts ansteht)
  echo -e "${BLUE}📝 Aktualisiere EN-Acks (nur für betroffene Keys)…${NC}"
  (cd "$FRONTEND_DIR" && BASE_REF="$BASE_REF" npm run i18n:ack) || true
fi

# Backend (Root-Server mit /api/bugreport) starten
# Hinweis: Wir starten den server.js im Projekt-Root, NICHT backend/server.js
# Damit stehen die Endpunkte /api/bugreport usw. zur Verfügung.
echo -e "${GREEN}🚀 Starte Root-Backend auf http://localhost:$BACKEND_PORT ...${NC}"
cd "$PROJECT_DIR" || exit 1
npm install
PORT=$BACKEND_PORT npm start &

# Frontend starten (Vite-Proxy routet /api → http://localhost:$BACKEND_PORT)
echo -e "${GREEN}🖼️ Starte Frontend auf http://localhost:$FRONTEND_PORT ...${NC}"
cd "$FRONTEND_DIR" || exit 1
npm install
npm run dev &

# Browser öffnen
#if command -v xdg-open >/dev/null; then
#  echo -e "${BLUE}🌐 Öffne Browser...${NC}"
#  xdg-open http://localhost:$FRONTEND_PORT
#fi

echo -e "${GREEN}✅ Beide Server laufen. Mit Ctrl+C kannst du beenden.${NC}"
wait
