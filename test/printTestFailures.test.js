// Deploy-Ausgabe bei fehlgeschlagenen Tests (scripts/print-test-failures.js und
// scripts/node-failures-reporter.js): Datei, Testname und erste Zeilen der Meldung, ohne Stack-Zeilen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectFailures, firstLines, formatFailures, printFromFile } = require('../scripts/print-test-failures.js');

const vitestJson = {
  testResults: [
    {
      name: '/repo/frontend/src/a.test.js',
      status: 'failed',
      assertionResults: [
        { fullName: 'Gruppe tut etwas', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2\nZeile 2\nZeile 3\nZeile 4\nZeile 5\n    at x (a.js:1:1)'] },
        { fullName: 'laeuft', status: 'passed', failureMessages: [] },
      ],
    },
    { name: '/repo/frontend/src/ok.test.js', status: 'passed', assertionResults: [{ fullName: 'ok', status: 'passed', failureMessages: [] }] },
    { name: '/repo/frontend/src/kaputt.test.js', status: 'failed', message: 'Cannot find module x', assertionResults: [] },
  ],
};

test('Vitest-JSON: nur gescheiterte Tests, Datei-Fehler ohne Einzeltest eingeschlossen', () => {
  const f = collectFailures(vitestJson);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { file: '/repo/frontend/src/a.test.js', name: 'Gruppe tut etwas', message: vitestJson.testResults[0].assertionResults[0].failureMessages[0] });
  assert.equal(f[1].file, '/repo/frontend/src/kaputt.test.js');
  assert.match(f[1].message, /Cannot find module/);
});

test('firstLines: hoechstens 4 Zeilen, Stack-Zeilen fallen weg; nur Stack: die ersten Zeilen', () => {
  assert.deepEqual(firstLines('A\nB\nC\nD\nE\n    at f (x:1:1)'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(firstLines('A\n    at f (x:1:1)'), ['A']);
  assert.deepEqual(firstLines('    at f (x:1:1)\n    at g (x:2:2)'), ['    at f (x:1:1)', '    at g (x:2:2)']);
  assert.deepEqual(firstLines(''), []);
});

test('formatFailures: Dateiname relativ, Testname, Meldung eingerueckt; leer ohne Fehler', () => {
  const text = formatFailures(collectFailures(vitestJson), { label: 'Tests (frontend)', cwd: '/repo' });
  assert.match(text, /Tests \(frontend\): 2 gescheiterte/);
  assert.match(text, /\n {2}- frontend\/src\/a\.test\.js\n {4}Gruppe tut etwas\n {6}AssertionError: expected 1 to be 2\n {6}Zeile 2\n {6}Zeile 3\n {6}Zeile 4\n/);
  assert.doesNotMatch(text, /Zeile 5|at x/);
  assert.equal(formatFailures([], { label: 'x' }), '');
});

test('printFromFile: unlesbare Datei gibt einen Hinweis aus und wirft nicht', () => {
  const out = [];
  assert.equal(printFromFile('/nicht/da.json', { label: 'Tests (Root)', stream: (m) => out.push(m) }), false);
  assert.match(out.join('\n'), /Tests \(Root\): keine auswertbare Ergebnisdatei/);
});

test('Reporter fuer node --test: schreibt gescheiterte Tests, Eltern-Suiten nur wegen Unterfaellen nicht', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-rep-'));
  try {
    const spec = path.join(dir, 'beispiel.test.js');
    fs.writeFileSync(spec, [
      "const test = require('node:test'); const assert = require('node:assert/strict');",
      "test('gut', () => {});",
      "test('Eltern', async (t) => { await t.test('Kind scheitert', () => { assert.equal(1, 2); }); });",
    ].join('\n'));
    const result = path.join(dir, 'result.json');
    // Ohne NODE_TEST_CONTEXT, sonst meldet der Kindlauf an den aeusseren Testlauf statt selbst zu laufen.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.SKM_TEST_RESULT_FILE;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
      `--test-reporter=${path.join(__dirname, '..', 'scripts', 'node-failures-reporter.js')}`, `--test-reporter-destination=${result}`, spec], { encoding: 'utf8', env });
    assert.notEqual(r.status, 0);
    const json = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.equal(json.failures.length, 1);
    assert.equal(json.failures[0].name, 'Kind scheitert');
    assert.equal(json.failures[0].file, spec);
    assert.match(json.failures[0].message, /Expected values to be strictly equal/);
    const text = formatFailures(collectFailures(json), { label: 'Tests (Root)', cwd: dir });
    assert.match(text, /- beispiel\.test\.js\n {4}Kind scheitert/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
