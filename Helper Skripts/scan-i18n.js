#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // 'used' oder 'hardcoded'
if (!mode || !['used', 'hardcoded'].includes(mode)) {
  console.error('❌ Bitte Modus angeben: "used" oder "hardcoded"');
  process.exit(1);
}

const TARGET_DIR = path.resolve(__dirname);
const FILE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const IGNORE_DIRS = ['node_modules', 'backend', 'config', 'history', '.git', 'dist', 'build'];
const IGNORE_FILES = ['scan-i18n.js'];

const usedKeys = {};
const hardcodedTexts = {};

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.includes(entry.name)) walk(fullPath);
    } else if (entry.isFile() && FILE_EXTENSIONS.includes(path.extname(entry.name)) && !IGNORE_FILES.includes(entry.name)
    ) {
        scanFile(fullPath);
      }
    }

  }
}

function scanFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;

    // === USED MODE: t('...')
    if (mode === 'used') {
      const tMatches = [...line.matchAll(/t\(\s*['"`]([^'"`]+)['"`]\s*\)/g)];
      for (const match of tMatches) {
        const key = match[1];
        if (!usedKeys[key]) usedKeys[key] = [];
        usedKeys[key].push(`${filePath}:${lineNumber}`);
      }
    }

    // === HARDCODED TEXTS: JSX-Textknoten ohne t()
    if (mode === 'hardcoded') {
      const jsxTextMatches = [...line.matchAll(/>([^<>]+)</g)];
      for (const match of jsxTextMatches) {
        const text = match[1].trim();
        if (text.length < 2 || /^\{.*\}$/.test(text)) continue;
        if (!hardcodedTexts[text]) hardcodedTexts[text] = [];
        hardcodedTexts[text].push(`${filePath}:${lineNumber}`);
      }

      // Klassische JS-Strings (nur UI-nah): z.B. alert("...")
      const alertMatches = [...line.matchAll(/alert\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)];
      for (const match of alertMatches) {
        const text = match[1].trim();
        if (!hardcodedTexts[text]) hardcodedTexts[text] = [];
        hardcodedTexts[text].push(`${filePath}:${lineNumber}`);
      }
    }
  });
}

// Start Scan
console.log(`🔍 Scanne ${TARGET_DIR} im Modus "${mode}"...`);
walk(TARGET_DIR);

// Speichern
if (mode === 'used') {
  fs.writeFileSync('translations_used.json', JSON.stringify(usedKeys, null, 2), 'utf8');
  console.log('✅ Fertig: translations_used.json erstellt.');
}

if (mode === 'hardcoded') {
  fs.writeFileSync('translations_hardcoded.json', JSON.stringify(hardcodedTexts, null, 2), 'utf8');
  console.log('✅ Fertig: translations_hardcoded.json erstellt.');
}
