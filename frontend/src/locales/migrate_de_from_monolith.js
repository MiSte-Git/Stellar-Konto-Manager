/* global require, __dirname, module, process */
/**
 * Migration-Skript:
 * Liest die alte monolithische de.json und de_keys.txt
 * und schreibt fehlende Keys in passende Namespaces unter frontend/src/locales/de/*.json.
 *
 * Verhalten:
 * - Namespace-Zuordnung erfolgt über zentrale Präfix-Regeln (NAMESPACE_RULES)
 * - vorhandene Keys in Namespace-Dateien werden niemals überschrieben (idempotent)
 * - verschachtelte Objekt-Struktur wird aus "a.b.c"-Pfade aufgebaut/erweitert
 * - am Ende werden pro Namespace Zähler für added/existing/missing protokolliert
 *
 * Verwendung (im Projektroot):
 *   node frontend/src/locales/migrate_de_from_monolith.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname); // .../frontend/src/locales
const MONOLITH_PATH = path.join(ROOT, 'de.json');
const KEYS_PATH = path.join(ROOT, 'de_keys.txt');
const DE_DIR = path.join(ROOT, 'de'); // Namespace-Dateien liegen im gleichen Verzeichnis

// Zentrale Namespace-Zuordnung über Präfix-Regeln
// Die Reihenfolge ist wichtig: erstes passendes Präfix gewinnt
const NAMESPACE_RULES = [
  { prefix: 'navigation.', namespace: 'navigation' },
  { prefix: 'network.', namespace: 'network' },
  { prefix: 'wallet.', namespace: 'wallet' },
  { prefix: 'trustline.', namespace: 'trustline' },
  { prefix: 'trustlines.', namespace: 'common' },
  { prefix: 'token.', namespace: 'token' },
  { prefix: 'quiz.ui.', namespace: 'quiz.ui' },
  { prefix: 'quiz.', namespace: 'quiz' },
  { prefix: 'settings.quiz.', namespace: 'settings.quiz' },
  { prefix: 'settings.', namespace: 'settings' },
  { prefix: 'publicKey.', namespace: 'publicKey' },
  { prefix: 'secretKey.', namespace: 'secretKey' },
  { prefix: 'submitTransaction.', namespace: 'submitTransaction' },
  { prefix: 'learn.', namespace: 'learn' },
  { prefix: 'glossary.', namespace: 'glossary' },
  { prefix: 'xlmByMemo.', namespace: 'xlmByMemo' },
  { prefix: 'investedTokens.', namespace: 'investedTokens' },
  { prefix: 'createAccount.', namespace: 'createAccount' },
  { prefix: 'multisigEdit.', namespace: 'multisigEdit' },
  { prefix: 'menu.', namespace: 'menu' },
  { prefix: 'home.', namespace: 'home' },
  // Fehler bevorzugt in errors.json; innerer Pfad ohne führendes "error."/"errors."
  { prefix: 'errors.', namespace: 'errors' },
  { prefix: 'error.', namespace: 'errors' },
  { prefix: 'query.', namespace: 'query' },
  // Fallback: alles andere landet in common.json
  { prefix: '', namespace: 'common' }
];

// Hilfsfunktion: Datei lesen und JSON parsen
function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Fehler beim Parsen von JSON in ${filePath}:`, err.message);
    throw err;
  }
}

// Hilfsfunktion: JSON schön schreiben
function writeJson(filePath, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

// Aus de.json per Pfad (a.b.c) den Wert holen
function getValueByPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

// Prüfen, ob ein Pfad in einem Objekt bereits existiert
function hasPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || !(part in current)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

// Pfad in Objekt erzeugen (verschachteln) und Wert setzen
function setValueByPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      // Nur setzen, wenn noch nicht vorhanden (Idempotenz / kein Überschreiben)
      if (!(part in current)) {
        current[part] = value;
      }
    } else {
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part];
    }
  }
}

// Namespace anhand des Key-Pfads bestimmen (zentrale Logik)
function detectNamespace(key) {
  for (const rule of NAMESPACE_RULES) {
    if (rule.prefix === '' || key.startsWith(rule.prefix)) {
      const namespace = rule.namespace;
      // innerPath: führendes Präfix entfernen, außer beim Fallback (prefix === '')
      const innerPath = rule.prefix ? key.substring(rule.prefix.length) : key;

      // Spezialfall errors/error: innerer Pfad ohne führendes "error."/"errors."
      if (namespace === 'errors') {
        const cleaned = key.replace(/^error\./, '').replace(/^errors\./, '');
        return { file: `${namespace}.json`, innerPath: cleaned };
      }

      return { file: `${namespace}.json`, innerPath };
    }
  }

  // Sollte durch die Fallback-Regel eigentlich nie erreicht werden
  return { file: 'common.json', innerPath: key };
}

function main() {
  console.log('Lese monolithische de.json …');
  const monolith = readJson(MONOLITH_PATH);

  console.log('Lese Keyliste de_keys.txt …');
  const rawKeys = fs.readFileSync(KEYS_PATH, 'utf8');
  const keys = rawKeys
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  console.log(`Insgesamt ${keys.length} Keys in de_keys.txt gefunden.`);

  // Namespace-Dateien-Cache: { filename: jsonObj }
  const namespaceCache = new Map();

  // Per-Namespace Statistik
  const stats = {};

  function ensureStats(nsFile) {
    if (!stats[nsFile]) {
      stats[nsFile] = {
        added: 0,
        existing: 0,
        missing: 0
      };
    }
    return stats[nsFile];
  }

  let migratedCount = 0;
  let skippedMissingValue = 0;
  let skippedExisting = 0;

  function loadNamespaceFile(filename) {
    if (namespaceCache.has(filename)) {
      return namespaceCache.get(filename);
    }
    const filePath = path.join(DE_DIR, filename);
    let data = {};
    if (fs.existsSync(filePath)) {
      data = readJson(filePath);
    } else {
      console.warn(`Namespace-Datei ${filename} existiert noch nicht, wird neu angelegt.`);
    }
    namespaceCache.set(filename, data);
    return data;
  }

  for (const key of keys) {
    const { file: nsFile, innerPath } = detectNamespace(key);
    const nsStats = ensureStats(nsFile);

    const value = getValueByPath(monolith, key);
    if (typeof value === 'undefined') {
      // Key in de.json nicht gefunden – für Statistik zählen, aber nicht in jeder Zeile loggen
      skippedMissingValue += 1;
      nsStats.missing += 1;
      continue;
    }

    const nsObj = loadNamespaceFile(nsFile);

    if (hasPath(nsObj, innerPath)) {
      // Existierender Key – nicht überschreiben
      skippedExisting += 1;
      nsStats.existing += 1;
      continue;
    }

    setValueByPath(nsObj, innerPath, value);
    migratedCount += 1;
    nsStats.added += 1;
  }

  // Alle geänderten Namespace-Dateien zurückschreiben
  for (const [filename, data] of namespaceCache.entries()) {
    const filePath = path.join(DE_DIR, filename);
    writeJson(filePath, data);
  }

  console.log('Migration abgeschlossen.');
  console.log(`Neu gesetzte Keys (gesamt):        ${migratedCount}`);
  console.log(`Übersprungene (bereits vorhanden): ${skippedExisting}`);
  console.log(`Übersprungene (kein Wert in de.json gefunden): ${skippedMissingValue}`);

  console.log('\nDetails pro Namespace-Datei:');
  Object.keys(stats)
    .sort()
    .forEach((nsFile) => {
      const nsStats = stats[nsFile];
      console.log(
        `  ${nsFile}: added ${nsStats.added}, existing ${nsStats.existing}, missing ${nsStats.missing}`
      );
    });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Migration fehlgeschlagen:', err);
    process.exit(1);
  }
}
