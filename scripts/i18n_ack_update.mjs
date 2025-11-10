#!/usr/bin/env node
/**
 * Helper to (re)write EN ack entries for keys with critical DE changes and updated EN.
 * Usage:
 *   node scripts/i18n_ack_update.mjs key1 key2 ...
 * If no keys are passed, updates all keys that require ack.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOCALES_DIR = path.join(ROOT, 'frontend', 'src', 'locales');
const ACK_DIR = path.join(LOCALES_DIR, '.i18n_ack');
const EN_ACK_FILE = path.join(ACK_DIR, 'en_ack.json');

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return ''; }
}
function deepMerge(a, b) { const out = { ...a }; for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v; return out; }
function flatten(obj, prefix = '') { const res = {}; if (!obj || typeof obj !== 'object') return res; for (const [k, v] of Object.entries(obj)) { const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(res, flatten(v, key)); else res[key] = v; } return res; }
function getLangMergedWorking(lang) { const rootFile = path.join(LOCALES_DIR, `${lang}.json`); const langDir = path.join(LOCALES_DIR, lang); let merged = {}; try { if (fs.existsSync(rootFile)) merged = deepMerge(merged, JSON.parse(fs.readFileSync(rootFile, 'utf8'))); } catch {}; if (fs.existsSync(langDir)) { for (const f of fs.readdirSync(langDir)) { if (!f.endsWith('.json')) continue; try { const j = JSON.parse(fs.readFileSync(path.join(langDir, f), 'utf8')); const ns = f.replace(/\.json$/, ''); merged = deepMerge(merged, { [ns]: j }); } catch {} } } return merged; }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// Phase-1 compatible normalization (no extra rules)
function normalizeUncritical(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  let out = s
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB\u2039\u203A]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  out = out
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ') ')
    .replace(/\s*([,:;!?])\s*/g, '$1 ')
    .replace(/\s+\./g, '.')
    .replace(/\s+$/g, '')
    .replace(/^\s+/g, '');
  return out;
}

// Git helpers to read base (like in Phase 2 script)
function gitShowJson(commit, relPath) {
  const fullPath = path.relative(ROOT, path.join(ROOT, relPath));
  const content = run(`git show ${commit}:${fullPath}`);
  if (!content) return null; try { return JSON.parse(content); } catch { return null; }
}
function gitListJsonFiles(commit, relDir) {
  const dirRel = path.relative(ROOT, path.join(ROOT, relDir));
  const out = run(`git ls-tree -r --name-only ${commit} ${dirRel}`);
  if (!out) return []; return out.split('\n').filter(f => f.endsWith('.json'));
}
function getLangMergedAt(commit, lang) {
  const relRootFile = path.join('frontend', 'src', 'locales', `${lang}.json`);
  const relLangDir = path.join('frontend', 'src', 'locales', lang);
  let merged = {};
  const rootJson = gitShowJson(commit, relRootFile);
  if (rootJson) merged = deepMerge(merged, rootJson);
  const files = gitListJsonFiles(commit, relLangDir);
  for (const f of files) {
    const j = gitShowJson(commit, f); if (!j) continue;
    const ns = path.basename(f).replace(/\.json$/, '');
    merged = deepMerge(merged, { [ns]: j });
  }
  return merged;
}

function main() {
  let baseRefEnv = process.env.BASE_REF || process.env.GITHUB_BASE_REF || 'origin/main';
  if (!baseRefEnv.includes('/')) baseRefEnv = `origin/${baseRefEnv}`;
  const baseCommit = run(`git merge-base ${baseRefEnv} HEAD`) || baseRefEnv;

  const deBase = flatten(getLangMergedAt(baseCommit, 'de'));
  const deHead = flatten(getLangMergedWorking('de'));
  const enBase = flatten(getLangMergedAt(baseCommit, 'en'));
  const enHead = flatten(getLangMergedWorking('en'));

  // Kritische DE-Änderungen ermitteln
  const changedKeys = Object.keys(deBase).filter(k => (k in deHead) && String(deBase[k]) !== String(deHead[k]));
  const critical = [];
  for (const k of changedKeys) {
    const a = normalizeUncritical(String(deBase[k]));
    const b = normalizeUncritical(String(deHead[k]));
    if (a !== b) critical.push(k);
  }

  // Nur Keys, bei denen EN aktualisiert wurde (Phase-1-Kette)
  const enUpdated = critical.filter(k => (k in enHead) && String(enHead[k]) !== String(enBase[k]));

  if (!fs.existsSync(ACK_DIR)) fs.mkdirSync(ACK_DIR, { recursive: true });
  const ack = fs.existsSync(EN_ACK_FILE) ? JSON.parse(fs.readFileSync(EN_ACK_FILE, 'utf8')) : { keys: {} };
  ack.keys = ack.keys || {};

  // Nur fehlende oder veraltete Acks autoselektieren
  const needingAck = enUpdated.filter(k => {
    const entry = ack.keys[k];
    const cur = { de_hash: sha256(deHead[k]), en_hash: sha256(enHead[k]) };
    return !entry || entry.de_hash !== cur.de_hash || entry.en_hash !== cur.en_hash;
  });

  // CLI-Keys (falls angegeben) auf betroffene beschränken, sonst auto-select der fehlenden
  const cliKeys = process.argv.slice(2);
  const targetKeys = cliKeys.length ? cliKeys.filter(k => enUpdated.includes(k)) : needingAck;

  if (!targetKeys.length) {
    console.log('No keys require ack.');
    return;
  }

  for (const k of targetKeys) {
    ack.keys[k] = {
      de_hash: sha256(deHead[k]),
      en_hash: sha256(enHead[k])
    };
  }
  fs.writeFileSync(EN_ACK_FILE, JSON.stringify(ack, null, 2) + '\n');
  console.log(`Updated ${EN_ACK_FILE} with ${targetKeys.length} key(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
