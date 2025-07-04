#!/bin/bash

# Verzeichnis setzen
PROJECT_DIR=~/Projekte/Stellar\ Trustline\ Manager
BACKEND_DIR=$PROJECT_DIR/backend

# Prüfe, ob index.html existiert
if [ ! -f "$PROJECT_DIR/index.html" ]; then
    echo "Error: index.html nicht gefunden. Bitte überprüfe das Verzeichnis."
    exit 1
fi

# Stelle sicher, dass config/wallets.json existiert
if [ ! -f "$PROJECT_DIR/config/wallets.json" ]; then
    mkdir -p "$PROJECT_DIR/config"
    echo '[]' > "$PROJECT_DIR/config/wallets.json"
    echo "Erstellt config/wallets.json."
fi

# Ignoriere unnötige Ordner (bereinige sie nicht, aber starte nicht darauf)
echo "Ignoriere unnötige Ordner: frontend/, history/, locales/, node_modules/."

# Starte den Webserver für das Frontend
echo "Starte Webserver für Frontend auf http://localhost:8080..."
cd "$PROJECT_DIR"
python3 -m http.server 8080 &

# Warte kurz, damit der Server startet
sleep 2

# Starte den Backend-Server (Node.js)
if [ -f "$BACKEND_DIR/server.js" ]; then
    echo "Starte Backend-Server auf http://localhost:3000..."
    cd "$BACKEND_DIR"
    if [ -f "package.json" ]; then
        npm install  # Installiere Abhängigkeiten, falls nötig
    fi
    node server.js &
else
    echo "Kein server.js im backend/ gefunden. Backend wird nicht gestartet."
fi

# Öffne den Browser (funktioniert unter Debian mit xdg-open)
if command -v xdg-open >/dev/null; then
    xdg-open http://localhost:8080
fi

echo "Webapp läuft. Drücke Ctrl+C, um den Server zu stoppen."
