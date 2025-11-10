#!/usr/bin/env node
/**
 * CI Phase-1 i18n Stale Check (Git-Diff based)
 *
 * - Detect German (de) text changes per key by comparing HEAD with base (default: origin/main)
 * - Classify changes as critical vs uncritical
 *   - Uncritical: whitespace-only, typographic quotes/apostrophes, dash variants, ellipsis, simple spacing harmonization
 *   - Critical: anything else (wording/phrases/terminology changes)
 * - Enforce translation chain: de -> en -> others
 *   - If critical DE changes and EN not updated for those keys => FAIL
 *   - If EN updated but other locales not updated => FAIL
 *   - Uncritical DE changes => WARN only (no fail)
 * - Reports:
 *   - content_backups/stale_keys_<lang>.txt listing keys requiring update due to DE changes
 *
 * Exit codes:
 * - 0 OK
 * - 1 Policy violation (stale translations for critical DE changes)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOCALES_DIR = path.join(ROOT, 'frontend', 'src', 'locales');
const REPORT_DIR = path.join(ROOT, 'content_backups');

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { return ''; }
}

function normalizeUncritical(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  // Normalize Unicode spaces to regular space
  let out = s
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // non-breaking & thin spaces
    // Normalize quotes
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB\u2039\u203A]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    // Normalize dashes
    .replace(/[\u2013\u2014]/g, '-')
    // Normalize ellipsis
    .replace(/\u2026/g, '...')
    // Collapse whitespace
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    // Trim
    .trim();

  // Harmonize simple spacing around parentheses and punctuation: remove superfluous spaces
  out = out
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ') ')
    .replace(/\s*([,:;!?])\s*/g, '$1 ')
    .replace(/\s+\./g, '.')
    .replace(/\s+$/g, '')
    .replace(/^\s+/g, '');

  return out;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}

function flatten(obj, prefix = '') {
  const res = {};
  if (!obj || typeof obj !== 'object') return res;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(res, flatten(v, key));
    } else {
      res[key] = v;
    }
  }
  return res;
}

function gitShowJson(commit, relPath) {
  const fullPath = path.relative(ROOT, path.join(ROOT, relPath));
  const content = run(`git show ${commit}:${fullPath}`);
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

function gitListJsonFiles(commit, relDir) {
  const dirRel = path.relative(ROOT, path.join(ROOT, relDir));
  const out = run(`git ls-tree -r --name-only ${commit} ${dirRel}`);
  if (!out) return [];
  return out.split('\n').filter(f => f.endsWith('.json'));
}

function getLangMergedAt(commit, lang) {
  // lang.json at root
  const relRootFile = path.join('frontend', 'src', 'locales', `${lang}.json`);
  const relLangDir = path.join('frontend', 'src', 'locales', lang);

  let merged = {};
  const rootJson = gitShowJson(commit, relRootFile);
  if (rootJson) merged = deepMerge(merged, rootJson);

  // Merge namespace files under /<lang>/*.json
  const files = gitListJsonFiles(commit, relLangDir);
  for (const f of files) {
    const j = gitShowJson(commit, f);
    if (!j) continue;
    const ns = path.basename(f).replace(/\.json$/, '');
    merged = deepMerge(merged, { [ns]: j });
  }
  return merged;
}

function getLangMergedWorking(lang) {
  // Working tree (HEAD) read from filesystem
  const rootFile = path.join(LOCALES_DIR, `${lang}.json`);
  const langDir = path.join(LOCALES_DIR, lang);
  let merged = {};
  try {
    if (fs.existsSync(rootFile)) merged = deepMerge(merged, JSON.parse(fs.readFileSync(rootFile, 'utf8')));
  } catch {}
  if (fs.existsSync(langDir)) {
    for (const f of fs.readdirSync(langDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(langDir, f), 'utf8'));
        const ns = f.replace(/\.json$/, '');
        merged = deepMerge(merged, { [ns]: j });
      } catch {}
    }
  }
  return merged;
}

function getAllLangsWorking() {
  const entries = fs.readdirSync(LOCALES_DIR);
  const langs = new Set();
  for (const e of entries) {
    if (e.endsWith('.json')) langs.add(e.replace(/\.json$/, ''));
    if (fs.existsSync(path.join(LOCALES_DIR, e)) && fs.statSync(path.join(LOCALES_DIR, e)).isDirectory()) langs.add(e);
  }
  langs.delete('de');
  return Array.from(langs);
}

function writeReport(lang, keys) {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const target = path.join(REPORT_DIR, `stale_keys_${lang}.txt`);
  const content = keys.length
    ? `Stale keys (must update due to DE changes):\n` + keys.map(k => `- ${k}`).join('\n') + '\n'
    : 'No stale keys.\n';
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function main() {
  let baseRefEnv = process.env.BASE_REF || process.env.GITHUB_BASE_REF || 'origin/main';
  if (!baseRefEnv.includes('/')) baseRefEnv = `origin/${baseRefEnv}`; // ensure remote-qualified ref
  // For a robust base commit, use merge-base with HEAD if base ref exists
  const baseCommit = run(`git merge-base ${baseRefEnv} HEAD`) || baseRefEnv;

  const deBase = getLangMergedAt(baseCommit, 'de');
  const deHead = getLangMergedWorking('de');
  const deBaseFlat = flatten(deBase);
  const deHeadFlat = flatten(deHead);

  // Determine changed keys existing in both versions (ignore newly added DE keys)
  const changedKeys = Object.keys(deBaseFlat).filter(k => Object.prototype.hasOwnProperty.call(deHeadFlat, k) && String(deBaseFlat[k]) !== String(deHeadFlat[k]));

  const critical = [];
  const uncritical = [];
  for (const k of changedKeys) {
    const a = normalizeUncritical(String(deBaseFlat[k]));
    const b = normalizeUncritical(String(deHeadFlat[k]));
    if (a === b) uncritical.push(k); else critical.push(k);
  }

  if (uncritical.length) {
    console.warn(`[CI:i18n:stale] Uncritical DE changes detected for ${uncritical.length} keys (whitespace/typography). No translation required.`);
  }

  if (!critical.length) {
    console.log('[CI:i18n:stale] No critical German content changes.');
    // Still write empty reports for consistency
    const langs = ['en', ...getAllLangsWorking().filter(l => l !== 'en')];
    for (const lang of langs) writeReport(lang, []);
    process.exit(0);
  }

  // Load base/head for all languages
  const langs = ['en', ...getAllLangsWorking().filter(l => l !== 'en')];
  const baseMaps = {};
  const headMaps = {};
  for (const lang of langs) {
    baseMaps[lang] = flatten(getLangMergedAt(baseCommit, lang));
    headMaps[lang] = flatten(getLangMergedWorking(lang));
  }

  // Per-language stale accumulation
  const stale = Object.fromEntries(langs.map(l => [l, []]));

  // Enforce chain per key
  for (const key of critical) {
    const enBase = baseMaps['en'][key];
    const enHead = headMaps['en'][key];
    const enUpdated = (enHead !== undefined) && (String(enHead) !== String(enBase));

    if (!enUpdated) {
      if (!stale['en'].includes(key)) stale['en'].push(key);
      // Do not check other languages for this key yet (chain enforcement)
      continue;
    }

    // EN updated; other locales must follow
    for (const lang of langs) {
      if (lang === 'en') continue;
      const baseV = baseMaps[lang][key];
      const headV = headMaps[lang][key];
      const updated = (headV !== undefined) && (String(headV) !== String(baseV));
      if (!updated) {
        if (!stale[lang].includes(key)) stale[lang].push(key);
      }
    }
  }

  // Write reports and decide exit code according to policy
  let fail = false;
  for (const lang of langs) {
    const file = writeReport(lang, stale[lang]);
    if (stale[lang].length) {
      const label = lang === 'en' ? 'EN must be updated first' : `Locale '${lang}' missing updates`;
      console.error(`[CI:i18n:stale] ${label}: ${stale[lang].length} key(s). See ${file}`);
      fail = true; // Any stale for critical keys fails
    }
  }

  if (fail) process.exit(1);
  console.log('[CI:i18n:stale] All translations updated for critical German changes.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (e) { console.error(`[CI:i18n:stale] Error: ${e?.message || e}`); process.exit(1); }
}
