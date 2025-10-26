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
