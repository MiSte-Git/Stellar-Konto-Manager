#!/usr/bin/env node
// Gibt die gescheiterten Tests eines Testlaufs kompakt aus: Datei, Testname und die ersten Zeilen der
// Fehlermeldung. Wird vom Deploy-Skript nach einem fehlgeschlagenen Lauf aufgerufen, damit der Grund am
// Ende der Ausgabe steht und nicht im Scrollback des Testlaufs verschwindet. Aendert nichts am Ablauf.
//
//   node scripts/print-test-failures.js <Bezeichnung> <ergebnis.json>
//
// Eingabeformate: Vitest-JSON (`--reporter=json`, testResults/assertionResults) und das Format des
// Reporters scripts/node-failures-reporter.js ({ failures: [{ file, name, message }] }).
'use strict';

const fs = require('fs');

const DEFAULT_LINES = 4;

/** Erste Zeilen einer Fehlermeldung, ohne Stack-Zeilen ("    at ..."); gibt es nur solche, die ersten Zeilen. */
function firstLines(message, count = DEFAULT_LINES) {
  const lines = String(message || '').split(/\r?\n/);
  const text = lines.filter((l) => !/^\s+at\s/.test(l));
  return (text.length ? text : lines).filter((l) => l.trim() !== '').slice(0, count);
}

/** Normalisiert beide Eingabeformate zu [{ file, name, message }]. */
function collectFailures(json) {
  if (Array.isArray(json?.failures)) {
    return json.failures.map((f) => ({ file: String(f.file || ''), name: String(f.name || ''), message: String(f.message || '') }));
  }
  const out = [];
  for (const suite of json?.testResults || []) {
    const failed = (suite.assertionResults || []).filter((a) => a.status === 'failed');
    for (const a of failed) {
      out.push({ file: suite.name || '', name: a.fullName || a.title || '', message: (a.failureMessages || [])[0] || '' });
    }
    // Datei scheitert, ohne dass ein einzelner Test scheitert (Import-/Setup-Fehler)
    if (suite.status === 'failed' && failed.length === 0) {
      out.push({ file: suite.name || '', name: '(Datei konnte nicht ausgefuehrt werden)', message: suite.message || '' });
    }
  }
  return out;
}

/** Text der Zusammenfassung; leer, wenn nichts gescheitert ist. */
function formatFailures(failures, { label = 'Tests', cwd = process.cwd(), lines = DEFAULT_LINES } = {}) {
  if (!failures.length) return '';
  const rel = (f) => (cwd && f.startsWith(cwd) ? f.slice(cwd.length).replace(/^[\\/]/, '') : f);
  const out = [`[deploy] ${label}: ${failures.length} gescheiterte(r) Test(s):`];
  for (const f of failures) {
    out.push(`  - ${rel(f.file)}`);
    if (f.name) out.push(`    ${f.name}`);
    for (const l of firstLines(f.message, lines)) out.push(`      ${l}`);
  }
  return out.join('\n');
}

/** Liest die Ergebnisdatei und gibt die Zusammenfassung aus. Liefert, ob etwas ausgegeben wurde. */
function printFromFile(file, { label, cwd, stream = console.error } = {}) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    stream(`[deploy] ${label || 'Tests'}: keine auswertbare Ergebnisdatei (${e.code || e.message}); Details stehen in der Ausgabe oben.`);
    return false;
  }
  const text = formatFailures(collectFailures(json), { label, cwd });
  if (!text) return false;
  stream(`\n${text}`);
  return true;
}

module.exports = { firstLines, collectFailures, formatFailures, printFromFile };

if (require.main === module) {
  const [label, file] = process.argv.slice(2);
  if (!file) {
    console.error('Aufruf: node scripts/print-test-failures.js <Bezeichnung> <ergebnis.json>');
    process.exit(2);
  }
  printFromFile(file, { label });
}
