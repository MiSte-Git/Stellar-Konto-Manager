'use strict';

// Serialisiert alle schreibenden Zugriffe auf denselben Job (Merge, Ablehnen, Loeschen).
// Ohne das arbeitet ein Handler nach seinen await-Pausen mit einem veralteten Job und
// ueberschreibt, was ein anderer inzwischen gespeichert hat (z. B. rejected durch einen
// Merge wieder auf pending oder sogar Einreichen). PHP serialisiert ueber withJobsLock.
const multisigJobLocks = new Map();
function withMultisigJobLock(id, fn) {
  const key = String(id || '');
  const previous = multisigJobLocks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  multisigJobLocks.set(key, tail);
  tail.then(() => { if (multisigJobLocks.get(key) === tail) multisigJobLocks.delete(key); });
  return run;
}

module.exports = { withMultisigJobLock };
