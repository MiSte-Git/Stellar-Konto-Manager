#!/usr/bin/env node
// Sync glossary keys from locales/de.json into locales/de/glossary.json
// - de.json is the reference
// - copies values from de.json.glossary.* to de/glossary.json (same nested structure)
// - does not overwrite existing different values; logs differences
// - optionally writes locales/<lang>/glossary.json for other languages with fallbacks

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');
const deMainPath = path.join(root, 'frontend/src/locales/de.json');
const deGlossaryPath = path.join(root, 'frontend/src/locales/de/glossary.json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function deepMerge(target, source, diffs) {
  Object.entries(source || {}).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v, diffs);
    } else {
      if (!(k in target)) {
        target[k] = v;
      } else if (target[k] !== v) {
        diffs.push({ key: k, from: target[k], to: v });
      }
    }
  });
}

function setLangGlossary(langPath, deGlossary) {
  const existing = readJson(langPath);
  // Only create missing structure; do not override existing
  const next = JSON.parse(JSON.stringify(existing));
  const diffs = [];
  deepMerge(next, deGlossary, diffs);
  if (JSON.stringify(existing) !== JSON.stringify(next)) {
    writeJson(langPath, next);
    console.log(`[sync] wrote ${langPath}`);
  }
  if (diffs.length) {
    console.warn(`[sync] ${langPath} differs for ${diffs.length} keys (left untouched)`);
  }
}

function main() {
  const de = readJson(deMainPath);
  const glossary = de.glossary || {};
  if (!Object.keys(glossary).length) {
    console.log('[sync] no glossary keys found in de.json');
    return;
  }
  const current = readJson(deGlossaryPath);
  const next = JSON.parse(JSON.stringify(current));
  const diffs = [];
  deepMerge(next, glossary, diffs);
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    writeJson(deGlossaryPath, next);
    console.log(`[sync] wrote ${deGlossaryPath}`);
  } else {
    console.log('[sync] de glossary up to date');
  }
  if (diffs.length) {
    console.warn(`[sync] de/glossary.json has ${diffs.length} differing keys (kept existing values)`);
  }

  // Optional: mirror for other languages if their glossary.json exists or should be created
  const langs = ['en', 'es', 'fr', 'it', 'nl', 'ru', 'fi', 'hr'];
  langs.forEach((lng) => {
    const p = path.join(root, `frontend/src/locales/${lng}/glossary.json`);
    setLangGlossary(p, glossary);
  });
}

main();
