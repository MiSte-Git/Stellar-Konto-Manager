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

# Optional Flag: --use-prod-backend / -p
# Wenn gesetzt, wird das lokale Backend nicht gestartet und das Frontend nutzt die PROD-API (aus .env: PROD_API_URL).
USE_PROD_BACKEND=0
EXPLICIT_MODE=0 # merkt, ob ein Parameter gesetzt wurde (dann keine Rückfrage)
for arg in "$@"; do
  case "$arg" in
    --use-prod-backend|-p) USE_PROD_BACKEND=1; EXPLICIT_MODE=1 ;;
    --use-local-backend|-l) USE_PROD_BACKEND=0; EXPLICIT_MODE=1 ;;
    *)
      echo -e "${YELLOW}⚠️ Unbekannter Parameter: $arg${NC}"
      echo "Verwendung: $0 [--use-prod-backend|-p] [--use-local-backend|-l]"
      exit 1
      ;;
  esac
done

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
: "${PROD_API_URL:=}"
: "${DEFAULT_PROD_API_URL:=https://skm.steei.de/api}"

# Interaktive Abfrage, falls kein expliziter Modus gewählt wurde
if [ "$EXPLICIT_MODE" -eq 0 ]; then
  while true; do
    echo -ne "${BLUE}Backend wählen: [l] lokal (Default) / [p] Prod-Backend ${NC}"
    read -r choice
    if [ -z "$choice" ] || [[ "$choice" =~ ^[lL]$ ]]; then
      USE_PROD_BACKEND=0
      break
    elif [[ "$choice" =~ ^[pP]$ ]]; then
      USE_PROD_BACKEND=1
      break
    else
      echo -e "${YELLOW}Ungültige Eingabe. Bitte l oder p wählen (Enter = lokal).${NC}"
    fi
  done
fi

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
if [ "$USE_PROD_BACKEND" -eq 0 ]; then
  echo -e "${GREEN}🚀 Starte Root-Backend auf http://localhost:$BACKEND_PORT ...${NC}"
  cd "$PROJECT_DIR" || exit 1
  npm install
  PORT=$BACKEND_PORT npm start &
else
  echo -e "${BLUE}ℹ️ Backend wird nicht gestartet (Option --use-prod-backend aktiv).${NC}"
fi

# Frontend starten (Vite-Proxy routet /api → http://localhost:$BACKEND_PORT)
if [ "$USE_PROD_BACKEND" -eq 1 ] && [ -z "$PROD_API_URL" ]; then
  echo -e "${YELLOW}⚠️ PROD_API_URL nicht gesetzt. Kein PROD-Backend konfiguriert.${NC}"
  # Interaktive Abfrage für PROD-URL (Default anzeigen)
  while [ -z "$PROD_API_URL" ]; do
    echo -ne "${BLUE}Bitte gib die URL des PROD-Backends ein (Enter für Default: ${DEFAULT_PROD_API_URL}): ${NC}"
    read -r input_prod_url
    if [ -z "$input_prod_url" ]; then
      PROD_API_URL="$DEFAULT_PROD_API_URL"
    else
      PROD_API_URL="$input_prod_url"
    fi
    # Basic validation: must start with https://
    if [[ ! "$PROD_API_URL" =~ ^https:// ]]; then
      echo -e "${YELLOW}⚠️ Ungültige URL (erwarte https://…). Bitte erneut eingeben.${NC}"
      PROD_API_URL=""
    fi
  done
  # Optional Reachability-Check (warn only)
  HEALTH_URL="${PROD_API_URL%/}/health"
  if command -v curl >/dev/null 2>&1; then
    if ! curl -fsSL --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      echo -e "${YELLOW}⚠️ Hinweis: Konnte ${HEALTH_URL} nicht erreichen. Prüfe URL/Netzwerk (nur Warnung, wird trotzdem verwendet).${NC}"
    fi
  fi
  echo -ne "${BLUE}Soll ich diesen Wert dauerhaft in .env speichern? [j/N] ${NC}"
  read -r save_choice
  if [[ "$save_choice" =~ ^[jJ]$ ]]; then
    if [ ! -f "$PROJECT_DIR/.env" ]; then
      touch "$PROJECT_DIR/.env"
    fi
    if grep -q '^PROD_API_URL=' "$PROJECT_DIR/.env"; then
      # Ersetze bestehenden Eintrag
      sed -i.bak "s|^PROD_API_URL=.*$|PROD_API_URL=${PROD_API_URL}|g" "$PROJECT_DIR/.env"
    else
      echo "PROD_API_URL=${PROD_API_URL}" >> "$PROJECT_DIR/.env"
    fi
    echo -e "${GREEN}✅ PROD_API_URL wurde gespeichert.${NC}"
  else
    echo -e "${BLUE}ℹ️ Verwende PROD_API_URL nur temporär für diesen Start.${NC}"
  fi
fi

API_BASE_FOR_FE=$([ "$USE_PROD_BACKEND" -eq 1 ] && echo "$PROD_API_URL" || echo "http://localhost:$BACKEND_PORT")

echo -e "${GREEN}🖼️ Starte Frontend auf http://localhost:$FRONTEND_PORT ...${NC}"
if [ "$USE_PROD_BACKEND" -eq 1 ]; then
  echo -e "${BLUE}🌐 Frontend lokal, Backend = PROD (${API_BASE_FOR_FE})${NC}"
fi
cd "$FRONTEND_DIR" || exit 1
npm install
VITE_BUILD_DATE=$(date -Iseconds) VITE_API_BASE_URL="$API_BASE_FOR_FE" npm run dev &

# Browser öffnen
#if command -v xdg-open >/dev/null; then
#  echo -e "${BLUE}🌐 Öffne Browser...${NC}"
#  xdg-open http://localhost:$FRONTEND_PORT
#fi

echo -e "${GREEN}✅ Beide Server laufen. Mit Ctrl+C kannst du beenden.${NC}"
# Hinweis: Legal-Seite zeigt jetzt „Zuletzt aktualisiert: <aktuelles Datum>“ basierend auf VITE_BUILD_DATE.
wait
