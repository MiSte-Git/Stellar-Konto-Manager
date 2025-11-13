#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();
const localesDir = path.join(root, 'frontend', 'src', 'locales');
const deRootFile = path.join(localesDir, 'de.json');
const deNsDir = path.join(localesDir, 'de');

// Known namespace suggestions for common prefixes
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

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) {
      keys.push(...flattenKeys(v, key));
    } else if (Array.isArray(v)) {
      // Include array indices to remain precise
      v.forEach((item, idx) => {
        const arrKey = `${key}.${idx}`;
        if (isObject(item)) {
          keys.push(...flattenKeys(item, arrKey));
        } else {
          keys.push(arrKey);
        }
      });
    } else {
      keys.push(key);
    }
  }
  return keys;
}

async function loadJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed parsing JSON: ${file}`);
    throw e;
  }
}

function groupByPrefix(keys) {
  const groups = new Map();
  for (const k of keys) {
    const [prefix] = k.split('.', 1);
    const p = prefix || 'root';
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(k);
  }
  return groups;
}

function variantKeysForRootKey(k, existingNs) {
  // Build possible representations of a root key that may appear in namespaces
  // Example: root key 'error.asset.creationDateUnknown' can appear as:
  // - 'error.asset.creationDateUnknown' (same)
  // - 'errors.asset.creationDateUnknown' (mapped namespace)
  // - 'asset.creationDateUnknown' (flat inside errors.json)
  const variants = new Set([k]);
  const [prefix] = k.split('.', 1);
  const rest = k.includes('.') ? k.slice(prefix.length + 1) : '';
  if (rest) {
    const mapped = SUGGESTED_NS_MAP[prefix];
    if (mapped) variants.add(`${mapped}.${rest}`);
    if (existingNs.has(prefix)) variants.add(`${prefix}.${rest}`);
    variants.add(rest);
  }
  return variants;
}

async function main() {
  const [deRoot, nsFiles] = await Promise.all([
    loadJson(deRootFile),
    fs.readdir(deNsDir)
  ]);

  const nsJsons = await Promise.all(
    nsFiles.filter(f => f.endsWith('.json')).map(async f => ({
      name: path.basename(f, '.json'),
      data: await loadJson(path.join(deNsDir, f))
    }))
  );

  const existingNs = new Set(['translation', ...nsJsons.map(n => n.name)]);

  const rootKeys = new Set(flattenKeys(deRoot));
  // Normalize namespace keys so they match root style:
  // For a namespace file named "trustline" with key "deleted.mode.real",
  // we consider it equivalent to root key "trustline.deleted.mode.real".
  // We also include raw keys as-is to support cases where a full path was stored in a namespace file.
  const nsKeys = new Set(
    nsJsons.flatMap(({ name, data }) => {
      const flat = flattenKeys(data);
      const withNs = flat.map(k => `${name}.${k}`);
      return [...flat, ...withNs];
    })
  );

  const missingInNs = [...rootKeys].filter(k => {
    const variants = variantKeysForRootKey(k, existingNs);
    for (const v of variants) {
      if (nsKeys.has(v)) return false;
    }
    return true;
  }).sort();
  const extraInNs = [...nsKeys].filter(k => !rootKeys.has(k)).sort();

  // Build grouped suggestion summary
  const groups = groupByPrefix(missingInNs);
  const summary = [];
  for (const [prefix, keys] of [...groups.entries()].sort((a,b) => b[1].length - a[1].length)) {
    const explicit = SUGGESTED_NS_MAP[prefix];
    const fallback = existingNs.has(prefix) ? prefix : 'translation';
    const suggestion = explicit || fallback;
    summary.push({ prefix, count: keys.length, suggestion, explicit: Boolean(explicit), examples: keys.slice(0, 5) });
  }

  const reportLines = [];
  reportLines.push(`Total keys in de.json: ${rootKeys.size}`);
  reportLines.push(`Total keys across German namespaces: ${nsKeys.size}`);
  reportLines.push(`Keys still only in de.json (not in any namespace): ${missingInNs.length}`);
  reportLines.push('');
  reportLines.push('Top prefixes and suggested namespaces:');
  for (const row of summary.slice(0, 50)) {
    const mark = row.explicit ? '*' : ' ';
    reportLines.push(`${mark} ${row.prefix} → ${row.suggestion} (${row.count}) e.g. ${row.examples.join(', ')}`);
  }
  reportLines.push('');
  reportLines.push('Sample keys (first 200):');
  reportLines.push(...missingInNs.slice(0, 200));
  reportLines.push('');
  reportLines.push('Keys present in namespaces but not in de.json (informational, first 200):');
  reportLines.push(...extraInNs.slice(0, 200));

  const outMissing = path.join(root, 'i18n-missing-namespace-keys.txt');
  const outGroups = path.join(root, 'i18n-missing-namespace-groups.json');

  await Promise.all([
    fs.writeFile(outMissing, missingInNs.join('\n'), 'utf8'),
    fs.writeFile(outGroups, JSON.stringify({ generatedAt: new Date().toISOString(), totalMissing: missingInNs.length, summary }, null, 2), 'utf8')
  ]);

  console.log(reportLines.join('\n'));
  console.log(`\nFull list written to: ${outMissing}`);
  console.log(`Grouped summary JSON written to: ${outGroups}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
