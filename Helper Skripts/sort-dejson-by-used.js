#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const USED_KEYS_FILE = 'translations_used.json';
const DE_JSON_PATH = path.resolve(__dirname, 'frontend', 'src', 'locales', 'de.json');
const OUTPUT_FILE = 'de.sorted.json'; // oder überschreib de.json direkt

if (!fs.existsSync(USED_KEYS_FILE)) {
  console.error(`❌ Datei ${USED_KEYS_FILE} fehlt. Bitte zuerst "scan-i18n.js used" ausführen.`);
  process.exit(1);
}

if (!fs.existsSync(DE_JSON_PATH)) {
  console.error(`❌ Datei ${DE_JSON_PATH} fehlt. Bitte gib den korrekten Pfad zu deiner de.json an.`);
  process.exit(1);
}

const used = JSON.parse(fs.readFileSync(USED_KEYS_FILE, 'utf8'));
const deJson = JSON.parse(fs.readFileSync(DE_JSON_PATH, 'utf8'));

const usedKeys = Object.keys(used);
const sorted = {};

// 1. Verwendete Keys zuerst (in der Reihenfolge aus used)
usedKeys.forEach((key) => {
  if (deJson[key] !== undefined) {
    sorted[key] = deJson[key];
  }
});

// 2. Optional: Restliche (nicht verwendete) Keys hintendran
Object.keys(deJson).forEach((key) => {
  if (!sorted[key]) {
    sorted[key] = deJson[key];
  }
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sorted, null, 2), 'utf8');
console.log(`✅ de.json sortiert gespeichert als: ${OUTPUT_FILE}`);
