// Regression guards for the empty-signer-list abort in the multisig merge
// route (M1 follow-up, review 2026-07-06): filterValidSignatures() run against
// an empty signer list returns an empty set, so persisting its result would
// wipe every previously collected signature from txXdrCurrent - irrecoverably,
// since the XDR is their only home. An empty list only ever means the Horizon
// signer lookup failed (an existing account always has at least its master key
// as a signer), so the merge route must fail closed instead.
//
// G5 stage 1 update: the live account lookup (fetchAccountMetaCached, a
// cached wrapper around loadAccount()) now runs unconditionally on every
// merge - not just as a heal attempt when job.signers was empty - because
// the sequence-obsolescence check needs the account's live sequence number
// regardless of whether the stored signer snapshot is already populated. The
// 502 abort still fires whenever no signer list (neither a fresh one from
// Horizon nor a previously-stored snapshot) is available.
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

test('the guard is preceded by an unconditional live account lookup (G5 stage 1: not just a heal-on-empty)', () => {
  const lookupIndex = serverSource.indexOf('fetchAccountMetaCached(net, job.accountId)', mergeRouteIndex);
  assert.ok(lookupIndex > mergeRouteIndex, 'the merge handler must fetch live account meta unconditionally');
  assert.ok(lookupIndex < guardIndex, 'the live lookup must come before giving up with 502');
});
