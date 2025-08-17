#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MAPPING_FILES = [
  'mapping_suggestions_with_text.json',
  'mapping_suggestions_de.unused.json'
];

const OUTPUT_FILE = 'mapping_combined.csv';

const allEntries = {};

// Einlesen & zusammenführen
for (const file of MAPPING_FILES) {
  if (!fs.existsSync(file)) {
    console.warn(`⚠️ Datei ${file} nicht gefunden, übersprungen.`);
    continue;
  }
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [originalKey, data] of Object.entries(content)) {
    if (!allEntries[originalKey]) {
      allEntries[originalKey] = {
        originalKey,
        suggestedKey: data.suggestedKey || '',
        text: data.text || '',
        source: file
      };
    }
  }
}

// CSV bauen
const lines = [];
lines.push(['originalKey', 'suggestedKey', 'text', 'source'].join(';'));

Object.values(allEntries).forEach(entry => {
  const line = [
    entry.originalKey,
    entry.suggestedKey,
    entry.text.replace(/[\r\n]+/g, ' ').replace(/"/g, "'"),
    entry.source
  ].map(field => `"${field}"`).join(';');
  lines.push(line);
});

fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
console.log(`✅ Mapping exportiert als CSV: ${OUTPUT_FILE}`);
console.log('👉 Du kannst die Datei in Excel, VS Code oder Sheets öffnen & bearbeiten.');
