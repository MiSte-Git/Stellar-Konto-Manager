// Regressionsschutz: Der Multisig-Job zum Loeschen von Trustlines (ListTrustlines.jsx,
// handlePrepareMultisig) hatte eine fest eingebaute Gueltigkeit von 60 Sekunden. Der Job
// war damit on-chain wertlos, bevor andere Signer ihn laden und signieren konnten
// (gleicher Fehler wie b2 in MultisigEditPage, siehe multisigEditPageWiring.test.js).
// Wie dort wird die Quelle direkt geprueft, da es fuer diese Komponente keinen
// Render-Test-Harness gibt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/components/ListTrustlines.jsx'), 'utf8');

function jobBuildSection() {
  const start = source.indexOf('const handlePrepareMultisig');
  assert.ok(start >= 0, 'handlePrepareMultisig muss existieren');
  const end = source.indexOf("apiUrl('multisig/jobs')", start);
  assert.ok(end > start, 'handlePrepareMultisig muss den Job per multisig/jobs anlegen');
  return source.slice(start, end);
}

test('Multisig-Job nutzt getMultisigTxTimeout statt fester 60 Sekunden', () => {
  const section = jobBuildSection();
  assert.ok(section.includes('getMultisigTxTimeout('), 'Timeout muss ueber getMultisigTxTimeout bestimmt werden');
  assert.ok(section.includes('immediateSubmit: false'), 'Job wird nicht sofort eingereicht');
  assert.ok(!/setTimeout\(\s*60\s*\)/.test(section), 'kein fest eingebautes setTimeout(60) im Job-Pfad');
});

test('Timeout kommt aus der Einstellung multisigTimeoutSeconds', () => {
  assert.ok(/const \{[^}]*multisigTimeoutSeconds[^}]*\} = useSettings\(\)/.test(source), 'multisigTimeoutSeconds aus useSettings lesen');
  assert.ok(jobBuildSection().includes('multisigTimeoutSeconds'), 'Einstellung im Job-Pfad verwenden');
});
