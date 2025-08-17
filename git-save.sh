#!/bin/bash

echo "📦️ Git-Save Menü"
echo "---------------------"
echo "1️⃣  Änderungen committen & pushen"
echo "2️⃣  Nur Status anzeigen"
echo "3️⃣  ❌ Abbrechen"
echo "---------------------"
read -p "Bitte Auswahl [1/2/3]: " auswahl

case "$auswahl" in
  1)
    echo ""
    git status
    echo ""
    read -p "✅ Commit-Beschreibung eingeben (oder mit [ENTER] abbrechen): " message

    if [[ -z "$message" ]]; then
      echo "❌ Kein Commit-Text eingegeben. Vorgang abgebrochen."
      exit 1
    fi

    git add .
    git commit -m "$message"
    git push
    echo "🚀 Änderungen gepusht."
    ;;
  2)
    echo ""
    git status
    ;;
  3)
    echo "🚪 Vorgang abgebrochen."
    exit 0
    ;;
  *)
    echo "⚠️ Ungültige Eingabe – bitte 1, 2 oder 3 wählen."
    exit 1
    ;;
esac
