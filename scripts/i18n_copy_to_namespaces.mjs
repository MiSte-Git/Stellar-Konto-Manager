#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();
const localesDir = path.join(root, 'frontend', 'src', 'locales');
const deRootFile = path.join(localesDir, 'de.json');
const deNsDir = path.join(localesDir, 'de');

// Namespaces registered in i18n.js; we do not add new ones here
const EXISTING_NS = new Set([
  'translation',
  'learn',
  'glossary',
  'home',
  'errors',
  'common',
  'menu',
  'trustline',
  'token',
  'createAccount',
  'multisigEdit',
  'publicKey',
  'network',
  'wallet',
  'navigation',
  'secretKey',
  'submitTransaction',
  'xlmByMemo',
  'investedTokens'
]);

// Explicit mapping from top-level key prefixes in de.json → namespace file
const SUGGESTED_NS_MAP = Object.freeze({
  error: 'errors',
  errors: 'errors',
  common: 'common',
  menu: 'menu',
  trustline: 'trustline',
  token: 'token',
  createAccount: 'createAccount',
  multisigEdit: 'multisigEdit',
  publicKey: 'publicKey',
  network: 'network',
  wallet: 'wallet',
  navigation: 'navigation',
  secretKey: 'secretKey',
  submitTransaction: 'submitTransaction',
  xlmByMemo: 'xlmByMemo',
  investedTokens: 'investedTokens',
  home: 'home',
  learn: 'learn',
  glossary: 'glossary'
});

function isObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

function flattenEntries(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) {
      out.push(...flattenEntries(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        const arrKey = `${key}.${idx}`;
        if (isObject(item)) out.push(...flattenEntries(item, arrKey));
        else out.push([arrKey, item]);
      });
    } else {
      out.push([key, v]);
    }
  }
  return out;
}

function ensureDir(p) {
  return fs.mkdir(p, { recursive: true });
}

function getTargetNamespaceForKey(k) {
  const [prefix] = k.split('.', 1);
  // Prefer explicit mapping
  const mapped = SUGGESTED_NS_MAP[prefix];
  if (mapped && EXISTING_NS.has(mapped)) return mapped;
  // If a namespace with the same name exists, use it
  if (EXISTING_NS.has(prefix)) return prefix;
  // Fallback: put into common to keep everything namespaced
  return 'common';
}

function stripPrefix(k, prefix) {
  if (!prefix) return k;
  if (k === prefix) return '';
  if (k.startsWith(prefix + '.')) return k.slice(prefix.length + 1);
  return k;
}

function setDeep(obj, pathStr, value) {
  const parts = pathStr.split('.').filter(Boolean);
  if (parts.length === 0) return false;
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const last = i === parts.length - 1;
    if (last) {
      if (cur[p] === undefined) {
        cur[p] = value;
        return true;
      }
      // Keep existing value, do not overwrite
      return false;
    }
    if (!isObject(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  return false;
}

async function loadJsonSafe(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function main() {
  await ensureDir(deNsDir);
  const deRootRaw = await fs.readFile(deRootFile, 'utf8');
  const deRoot = JSON.parse(deRootRaw);
  const entries = flattenEntries(deRoot);

  // Load all namespace files upfront
  const nsFiles = Array.from(EXISTING_NS).filter(ns => ns !== 'translation');
  const nsJson = Object.fromEntries(await Promise.all(
    nsFiles.map(async ns => [ns, await loadJsonSafe(path.join(deNsDir, `${ns}.json`), {})])
  ));

  const stats = { created: 0, skipped: 0, byNs: {} };
  function inc(ns, field) {
    stats.byNs[ns] = stats.byNs[ns] || { created: 0, skipped: 0 };
    stats[field]++;
    stats.byNs[ns][field]++;
  }

  for (const [key, val] of entries) {
    const ns = getTargetNamespaceForKey(key);
    const [prefix] = key.split('.', 1);
    const destPath = (ns === prefix || SUGGESTED_NS_MAP[prefix] === ns)
      ? stripPrefix(key, prefix)
      : key; // keep full key path when falling back to common

    if (!destPath) {
      // Edge: key has no subpath after stripping; put under key 'value'
      if (setDeep(nsJson[ns], 'value', val)) inc(ns, 'created'); else inc(ns, 'skipped');
      continue;
    }

    if (setDeep(nsJson[ns], destPath, val)) inc(ns, 'created'); else inc(ns, 'skipped');
  }

  // Write back namespace files
  await Promise.all(nsFiles.map(async ns => {
    const file = path.join(deNsDir, `${ns}.json`);
    const data = JSON.stringify(nsJson[ns], null, 2) + '\n';
    await fs.writeFile(file, data, 'utf8');
  }));

  // Report
  const lines = [];
  lines.push(`Processed ${entries.length} keys from de.json`);
  lines.push(`Created ${stats.created} namespaced entries, skipped (already present) ${stats.skipped}`);
  lines.push('Per-namespace:');
  for (const ns of nsFiles) {
    const s = stats.byNs[ns] || { created: 0, skipped: 0 };
    lines.push(`  ${ns}: +${s.created}, ~${s.skipped}`);
  }
  console.log(lines.join('\n'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
