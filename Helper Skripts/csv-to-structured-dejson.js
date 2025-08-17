#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const INPUT_CSV = 'mapping_combined_bereinigt.csv';
const OUTPUT_JSON = 'de.structured.json';
const DELIMITER = ','; // z. B. ',' oder ';'

function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(DELIMITER).map(h => h.replace(/^["']|["']$/g, '').trim());

  const suggestedKeyIdx = header.indexOf('suggestedKey');
  const textIdx = header.indexOf('text');

  if (suggestedKeyIdx === -1 || textIdx === -1) {
    console.error('❌ Spalten "suggestedKey" und "text" werden benötigt.');
    process.exit(1);
  }

  const result = {};

  for (const line of lines) {
    const cols = line.split(DELIMITER).map(c => c.replace(/^["']|["']$/g, '').trim());
    const keyPath = cols[suggestedKeyIdx];
    const text = cols[textIdx];

    if (!keyPath || !text || text.startsWith('(❌')) continue;

    const keys = keyPath.split('.');
    let current = result;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i === keys.length - 1) {
        current[key] = text;
      } else {
        current[key] = current[key] || {};
        current = current[key];
      }
    }
  }

  return result;
}

const json = parseCSV(INPUT_CSV);
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(json, null, 2), 'utf8');

console.log(`✅ Strukturierte de.json gespeichert als: ${OUTPUT_JSON}`);
