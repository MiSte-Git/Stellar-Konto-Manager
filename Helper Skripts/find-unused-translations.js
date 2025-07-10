#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const USED_KEYS_FILE = 'translations_used.json';
const DE_JSON_PATH = path.resolve(__dirname, 'frontend', 'src', 'locales', 'de.json');
const OUTPUT_FILE = 'de.unused.json';

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

const usedKeys = new Set(Object.keys(used));
const unused = {};

Object.keys(deJson).forEach((key) => {
  if (!usedKeys.has(key)) {
    unused[key] = deJson[key];
  }
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(unused, null, 2), 'utf8');
console.log(`✅ ${Object.keys(unused).length} unbenutzte Keys gefunden.`);
console.log(`📄 Gespeichert als: ${OUTPUT_FILE}`);
