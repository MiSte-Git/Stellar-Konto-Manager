#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [,, inputFile, referenceFile] = process.argv;

if (!inputFile) {
  console.error('❌ Bitte Eingabedatei angeben (z. B. de.json oder de.unused.json)');
  console.error('🔁 Optional: Referenzdatei für Texte (z. B. de.json)');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Eingabedatei ${inputFile} nicht gefunden.`);
  process.exit(1);
}

const inputJson = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
let referenceJson = inputJson;

if (referenceFile) {
  if (!fs.existsSync(referenceFile)) {
    console.error(`❌ Referenzdatei ${referenceFile} nicht gefunden.`);
    process.exit(1);
  }
  referenceJson = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
}

// Hilfsfunktion: Erzeugt strukturierte Vorschläge aus einem Key
function autoMapKey(key) {
  if (key.includes(':')) {
    const [prefix, suffix] = key.split(':', 2);
    return `${normalize(prefix)}.${normalize(suffix)}`;
  }
  return normalize(key);
}

function normalize(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1.$2') // camelCase → camel.case
    .replace(/[^a-zA-Z0-9]/g, '.')          // Sonderzeichen zu Punkt
    .replace(/\.+/g, '.')                   // doppelte Punkte zusammenfassen
    .replace(/^\./, '').replace(/\.$/, '')  // . am Anfang/Ende entfernen
    .toLowerCase();
}

const mapping = {};
for (const key of Object.keys(inputJson)) {
  const text = referenceJson[key] ?? '(❌ kein Text gefunden)';
  mapping[key] = {
    text,
    suggestedKey: autoMapKey(key)
  };
}

const base = path.basename(inputFile, '.json');
const outputFile = `mapping_suggestions_${base}.json`;

fs.writeFileSync(outputFile, JSON.stringify(mapping, null, 2), 'utf8');
console.log(`✅ Mapping-Vorschläge gespeichert in ${outputFile}`);
