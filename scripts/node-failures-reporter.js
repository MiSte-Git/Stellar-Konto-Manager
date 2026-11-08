// Eigener Reporter fuer `node --test`: schreibt am Ende die gescheiterten Tests als JSON
// ({ failures: [{ file, name, message }] }) in die Datei aus SKM_TEST_RESULT_FILE, sonst in das Ziel,
// das mit --test-reporter-destination angegeben ist. (Die Datei per Umgebungsvariable zu geben haelt das
// npm-Skript test:report plattformunabhaengig; Optionen hinter dem Glob von `npm test --` wuerde node als Dateien lesen.) Gedacht fuer das Deploy-Skript (siehe scripts/print-test-failures.js); die normale
// Ausgabe (spec) laeuft daneben unveraendert.
'use strict';

const fs = require('fs');

module.exports = async function* nodeFailuresReporter(source) {
  const failures = [];
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const err = event.data?.details?.error;
    // Ein Eltern-Test/Suite, der nur wegen gescheiterter Unterfaelle scheitert, ist kein eigener Fehler.
    if (err?.failureType === 'subtestsFailed') continue;
    const cause = err?.cause && typeof err.cause === 'object' ? err.cause : err;
    failures.push({
      file: event.data?.file || '',
      name: event.data?.name || '',
      message: String(cause?.stack || cause?.message || err?.message || err || ''),
    });
  }
  const json = JSON.stringify({ failures });
  const file = process.env.SKM_TEST_RESULT_FILE;
  if (file) {
    fs.writeFileSync(file, json);
    return;
  }
  yield json;
};
