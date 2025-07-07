#!/bin/bash

echo "📦️ Git-Save: Änderungen werden geprüft..."

# Änderungen anzeigen
git status

echo ""
read -p "✅ Commit-Beschreibung eingeben: " message

git add .
git commit -m "$message"
git push

echo "🚀 Änderungen gepusht."
