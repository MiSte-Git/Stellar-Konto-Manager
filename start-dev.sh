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

# Backend starten
echo -e "${GREEN}🚀 Starte Backend auf http://localhost:$BACKEND_PORT ...${NC}"
cd "$BACKEND_DIR" || exit 1
npm install
npm run dev &

# Frontend starten
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
