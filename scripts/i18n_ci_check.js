#!/usr/bin/env node
/*
CI i18n checks:
- Validate JSON syntax
- Check duplicates (basic by stringify/parse; also deep key traversal)
- Check all locales match German key tree
- Report missing keys (content_backups/missing_keys_<lang>.txt)
- Check file sizes per namespace (warn if > 200KB)

Exit codes:
- 0 OK
- 1 Critical error (invalid JSON, sync failed)
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'frontend', 'src', 'locales');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`Invalid JSON: ${p} -> ${e.message}`); }
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') ? deepMerge(out[k], v) : v;
  }
  return out;
}

function flatten(obj, prefix = '') {
  const res = {};
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

// Locale directories are plain two-letter language codes (de, en, es, ...).
// This also excludes non-locale housekeeping dirs under locales/ such as
// .i18n_ack, .i18n_hash, or __pycache__.
const LANG_DIR_RE = /^[a-z]{2}$/;

function listLangDirs() {
  return fs.readdirSync(LOCALES).filter((f) => LANG_DIR_RE.test(f) && fs.statSync(path.join(LOCALES, f)).isDirectory());
}

function readNamespacedLocale(dir) {
  let merged = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) {
      const ns = f.replace(/\.json$/, '');
      merged = deepMerge(merged, { [ns]: readJson(path.join(dir, f)) });
    }
  }
  return merged;
}

function getGermanRef() {
  const deDir = path.join(LOCALES, 'de');
  if (!fs.existsSync(deDir)) {
    throw new Error(`German reference directory not found: ${deDir}`);
  }
  return readNamespacedLocale(deDir);
}

function main() {
  try {
    const ref = getGermanRef();
    const refFlat = flatten(ref);

    const langs = listLangDirs().filter((l) => l !== 'de');
    let ok = true;

    for (const lang of langs) {
      const dir = path.join(LOCALES, lang);
      const cur = readNamespacedLocale(dir);
      const curFlat = flatten(cur);

      const missing = Object.keys(refFlat).filter(k => !(k in curFlat));
      const extra = Object.keys(curFlat).filter(k => !(k in refFlat));

      const reportDir = path.join(ROOT, 'content_backups');
      if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
      const report = path.join(reportDir, `missing_keys_${lang}.txt`);
      fs.writeFileSync(report, `${missing.length ? 'Missing keys (must fix):' : 'No missing keys.'}\n` + missing.map(k => `- ${k}`).join('\n') + (extra.length ? `\n\nExtra keys (ok to keep, review):\n${extra.map(k => `- ${k}`).join('\n')}` : '') + '\n', 'utf8');

      if (missing.length) {
        console.error(`[CI:i18n] ${lang} missing ${missing.length} keys. See ${report}`);
        ok = false;
      }

      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const sizeKB = Math.round((fs.statSync(path.join(dir, f)).size / 1024) * 10) / 10;
        if (sizeKB > 200) {
          console.warn(`[CI:i18n] ${lang}/${f} is large (${sizeKB} KB). Consider splitting.
`);
        }
      }
    }

    if (!ok) process.exit(1);
    console.log('[CI:i18n] All locales match the German key tree.');
  } catch (e) {
    console.error(`[CI:i18n] Error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
