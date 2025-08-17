#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

//const USED_KEYS_FILE = 'translations_used.json';
const USED_KEYS_FILE = 'de.unused.json';
//const DE_JSON_PATH = path.resolve(__dirname, 'frontend', 'src', 'locales', 'de.json');
const DE_JSON_PATH = path.resolve(__dirname, 'de.unused.json');
const OUTPUT_FILE = 'mapping_suggestions_with_text_unused.json';

if (!fs.existsSync(USED_KEYS_FILE)) {
  console.error(`❌ Datei ${USED_KEYS_FILE} fehlt. Bitte zuerst "scan-i18n.js used" ausführen.`);
  process.exit(1);
}

if (!fs.existsSync(DE_JSON_PATH)) {
  console.error(`❌ Datei ${DE_JSON_PATH} fehlt. Bitte gib den korrekten Pfad zu deiner de.json an.`);
  process.exit(1);
}

const usedKeys = JSON.parse(fs.readFileSync(USED_KEYS_FILE, 'utf8'));
const deJson = JSON.parse(fs.readFileSync(DE_JSON_PATH, 'utf8'));

const mapping = {};

function autoMapKey(key) {
  if (key.includes(':')) {
    const [prefix, suffix] = key.split(':', 2);
    return `${normalize(prefix)}.${normalize(suffix)}`;
  }
  return normalize(key);
}

function normalize(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1.$2')
    .replace(/[^a-zA-Z0-9]/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

for (const key of Object.keys(usedKeys)) {
  const text = deJson[key] ?? '(❌ kein Text in de.json gefunden)';
  mapping[key] = {
    text: text,
    suggestedKey: autoMapKey(key)
  };
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2), 'utf8');
console.log(`✅ Datei erstellt: ${OUTPUT_FILE}`);
console.log('👉 Du kannst nun suggestedKey-Werte nach Wunsch anpassen.');
