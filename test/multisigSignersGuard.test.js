// Regression guards for the empty-signer-list abort in the multisig merge
// route (M1 follow-up, review 2026-07-06): filterValidSignatures() run against
// an empty signer list returns an empty set, so persisting its result would
// wipe every previously collected signature from txXdrCurrent - irrecoverably,
// since the XDR is their only home. An empty list only ever means the Horizon
// signer lookup failed (an existing account always has at least its master key
// as a signer), so the merge route must fail closed instead: try once to heal
// the job's empty creation-time snapshot from the live account, and abort with
// signers_unavailable if that also fails.
//
// server.js isn't structured for HTTP-level testing (it calls app.listen() at
// module load time), so - same approach as test/serverCorsRegression.test.js -
// these check the source directly for the specific patterns the fix requires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const mergeRouteIndex = serverSource.indexOf("app.post('/api/multisig/jobs/:id/merge-signed-xdr'");
const guardIndex = serverSource.indexOf("res.status(502).json({ ok: false, error: 'signers_unavailable' })");
const filterIndex = serverSource.indexOf('filterValidSignatures(current.tx, signers)');

test('merge route contains the signers_unavailable abort', () => {
  assert.ok(mergeRouteIndex > -1, 'sanity: the merge route exists');
  assert.ok(guardIndex > -1, 'the 502 signers_unavailable response must exist');
  assert.ok(guardIndex > mergeRouteIndex, 'the abort must live inside the merge handler');
});

test('the abort runs before filterValidSignatures() can see an empty signer list', () => {
  assert.ok(filterIndex > -1, 'sanity: the merge route still filters signatures');
  assert.ok(guardIndex < filterIndex, 'guard must precede the filtering that would wipe signatures');
});

test('the guard first tries to heal an empty creation-time snapshot from the live account', () => {
  const healIndex = serverSource.indexOf('loadAccount(serverForNet, job.accountId)', mergeRouteIndex);
  assert.ok(healIndex > mergeRouteIndex, 'the merge handler must attempt a live signer reload');
  assert.ok(healIndex < guardIndex, 'the heal attempt must come before giving up with 502');
});
