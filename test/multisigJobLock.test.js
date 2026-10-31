// Sperre pro Multisig-Job in Node (review_decline_sonnet.md, Races Merge/Ablehnen/Loeschen).
const test = require('node:test');
const assert = require('node:assert/strict');
const { withMultisigJobLock } = require('../services/multisigJobLock.js');

const tick = () => new Promise((r) => setTimeout(r, 5));

test('Zugriffe auf denselben Job laufen nacheinander, auch ueber await hinweg', async () => {
  const log = [];
  const a = withMultisigJobLock('job-1', async () => { log.push('a1'); await tick(); log.push('a2'); return 'a'; });
  const b = withMultisigJobLock('job-1', async () => { log.push('b1'); await tick(); log.push('b2'); return 'b'; });
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.deepEqual(log, ['a1', 'a2', 'b1', 'b2']);
});

test('Verschiedene Jobs blockieren sich nicht', async () => {
  const log = [];
  const a = withMultisigJobLock('job-a', async () => { log.push('a1'); await tick(); log.push('a2'); });
  const b = withMultisigJobLock('job-b', async () => { log.push('b1'); await tick(); log.push('b2'); });
  await Promise.all([a, b]);
  assert.deepEqual(log.slice(0, 2).sort(), ['a1', 'b1']);
});

test('Ein Fehler gibt die Sperre frei und erreicht nur den eigenen Aufrufer', async () => {
  const failing = withMultisigJobLock('job-x', async () => { throw new Error('kaputt'); });
  const next = withMultisigJobLock('job-x', async () => 'weiter');
  await assert.rejects(failing, /kaputt/);
  assert.equal(await next, 'weiter');
});
