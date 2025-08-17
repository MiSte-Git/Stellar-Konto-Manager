#!/bin/bash

# Projektpfade anpassen
PROJECT_DIR=~/Projekte/Stellar\ Trustline\ Manager
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"

# Backend starten (Port 3000)
echo "Starte Backend auf http://localhost:3000 ..."
cd "$BACKEND_DIR" || exit
npm install
npm run dev &

# Warte kurz, bis Backend initialisiert ist
sleep 2

# Frontend starten (Port 5173 o. ä.)
echo "Starte Frontend (Vite) ..."
cd "$FRONTEND_DIR" || exit
npm install
npm run dev &

# Öffne den Browser automatisch (optional)
if command -v xdg-open >/dev/null; then
  xdg-open http://localhost:5173
fi

echo "Beide Server laufen. Drücke Ctrl+C zum Beenden."
