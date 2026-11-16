// ADR 0014 (Node): reine Funktionen der Klaerung extern gesendeter Jobs gegen die gemeinsame Fixture
// test/assets/external-submit.json (Kandidaten, Datensatz aus GET /transactions/{hash}, Ergebnis,
// Reihenfolge im Budget, Endzustand mit freier Sequence). Pendant: test/externalSubmit.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isExternalCheckCandidate, transactionLookupFromRecord, externalOutcome, compareResolvePriority,
  externalUnconsumedOutcome, isPastMaxTimeByClock,
} = require('../services/submitUnclear');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'external-submit.json'), 'utf8'));
const JOB_HASH = '3d5d0f50'.padEnd(64, '0');
const withHash = (value) => JSON.parse(JSON.stringify(value ?? null).split('$JOB_HASH').join(JOB_HASH));

test('Fixture: alle Abschnitte vorhanden', () => {
  for (const key of ['candidateCases', 'recordCases', 'outcomeCases', 'orderCases', 'routeCases', 'unconsumedCases']) {
    assert.ok(Array.isArray(fixture[key]) && fixture[key].length > 0, key);
  }
});

for (const c of fixture.candidateCases) {
  test(`Kandidat: ${c.name}`, () => {
    assert.equal(isExternalCheckCandidate(c.job), c.expected);
  });
}

for (const c of fixture.recordCases) {
  test(`Datensatz: ${c.name}`, () => {
    assert.deepEqual(transactionLookupFromRecord(withHash(c.record), JOB_HASH), withHash(c.expected));
  });
}

test('Datensatz: Ledger unter ledger_attr (SDK) zaehlt', () => {
  const out = transactionLookupFromRecord({ hash: JOB_HASH, successful: true, ledger_attr: 12 }, JOB_HASH);
  assert.equal(out.ledger, 12);
});

for (const c of fixture.outcomeCases) {
  test(`Ergebnis: ${c.name}`, () => {
    assert.deepEqual(externalOutcome(withHash(c.lookup), c.ledgerPastMaxTime, c.storedStatus), withHash(c.expected));
  });
}

for (const c of fixture.orderCases) {
  test(`Reihenfolge: ${c.name}`, () => {
    const sorted = [...c.items].sort((a, b) => compareResolvePriority(a, b, c.now));
    assert.deepEqual(sorted.map((i) => i.name), c.expected);
  });
}

// ES-9: Endzustand mit freier Sequence nach der Marge: Status bleibt, sonst nichts.
for (const c of fixture.unconsumedCases) {
  test(`Freie Sequence: ${c.name}`, () => {
    assert.deepEqual(externalUnconsumedOutcome(c.storedStatus, c.ledgerPastMaxTime), c.expected);
  });
}

test('Serveruhr: maxTime 0 nie vorbei, Grenze bei maxTime plus 60 s', () => {
  assert.equal(isPastMaxTimeByClock(0, Number.MAX_SAFE_INTEGER), false);
  assert.equal(isPastMaxTimeByClock(1000, 1060), false);
  assert.equal(isPastMaxTimeByClock(1000, 1061), true);
});
