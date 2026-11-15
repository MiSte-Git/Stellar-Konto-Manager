// R-6 (Node): Einordnung unklar oder abgelehnt beim Senden eines Multisig-Jobs, gegen die gemeinsame
// Fixture test/assets/submit-classification.json (gleiche Faelle in test/submitClassification.test.php).
// Fehler wie aus Horizon.Server#submitTransaction (err.response.status/data), 2xx als Rueckgabewert.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isUnclearSubmitError, isUnclearSubmitSuccess } = require('../services/submitUnclear');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'submit-classification.json'), 'utf8'));

test('Fixture hat Faelle', () => assert.ok(cases.length >= 20));

for (const c of cases) {
  test(`R-6: ${c.name} -> ${c.unclear ? 'unklar' : 'eindeutig'}`, () => {
    let actual;
    if (typeof c.status === 'number' && c.status >= 200 && c.status < 300) {
      actual = isUnclearSubmitSuccess(c.data);
    } else if (c.status === null) {
      actual = isUnclearSubmitError(new Error('socket hang up'));
    } else {
      actual = isUnclearSubmitError(Object.assign(new Error(`status ${c.status}`), { response: { status: c.status, data: c.data } }));
    }
    assert.equal(actual, c.unclear);
  });
}
