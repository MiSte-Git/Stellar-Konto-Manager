// Tests for services/multisigLifecycle.js (G5 stage 1: expired/obsolete_seq
// existed as job-status labels since the H1/M1 hardening round but nothing
// ever computed them - see analyse_multisig.md b5 and the follow-up
// time-window analysis). Mirrors test/multisigLifecycle.test.php - keep both
// in sync.
//
// server.js itself cannot be required directly in a test (it calls
// app.listen() at module load time - see test/multisigSignersGuard.test.js's
// header comment), so the wiring of this logic into the list/merge/create
// routes is covered separately by source-pattern assertions in
// test/multisigLifecycleWiring.test.js. This file exercises the actual
// decision logic directly against real SDK-built Transaction objects - no
// Horizon network access required, same approach as test/txSignatures.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Account, TransactionBuilder, Operation, Networks, Keypair } = require('@stellar/stellar-sdk');
const { computeMultisigLifecycleStatus, extractMaxTimeUnix, mapSubmitResultCodeToLifecycleStatus } = require('../services/multisigLifecycle.js');

// Builds a transaction from an account currently at sequence startSeq
// (string), with an explicit maxTime (unix seconds; 0 = unbounded).
function buildTx(startSeq, maxTimeUnix) {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), startSeq);
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: String(BigInt(startSeq) + 1n) }))
    .setTimebounds(0, maxTimeUnix)
    .build();
}

const now = Math.floor(Date.now() / 1000);

// --- computeMultisigLifecycleStatus: sequence -------------------------------

test('a transaction whose sequence is exactly one greater than the account sequence is viable (null)', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now + 3600), '100', now), null);
});

test('a transaction whose sequence equals the current account sequence is obsolete_seq (already consumed)', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now + 3600), '101', now), 'obsolete_seq');
});

test('a transaction whose sequence is behind the current account sequence is obsolete_seq', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now + 3600), '500', now), 'obsolete_seq');
});

test('accountSequence === null (Horizon lookup unavailable) skips the sequence check entirely', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now + 3600), null, now), null);
});

test('sequence comparison handles values beyond Number.MAX_SAFE_INTEGER correctly (BigInt, not Number)', () => {
  const bigSeq = '9223372036854775800'; // near int64 max, way past 2^53
  const tx = buildTx(bigSeq, now + 3600); // tx.sequence === bigSeq + 1
  assert.equal(computeMultisigLifecycleStatus(tx, tx.sequence, now), 'obsolete_seq', 'account sequence already at the tx sequence must be obsolete_seq');
  assert.equal(computeMultisigLifecycleStatus(tx, bigSeq, now), null, 'account sequence one behind the tx sequence must still be viable');
});

// --- computeMultisigLifecycleStatus: timebounds -----------------------------

test('a transaction whose maxTime has already passed is expired', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now - 60), '100', now), 'expired');
});

test('a transaction whose maxTime is still in the future is not expired', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now + 60), '100', now), null);
});

test('a transaction with an explicit maxTime of 0 (unbounded) never expires, even long "after" now', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', 0), '100', now + 10_000_000), null);
});

test('a transaction whose timeBounds is entirely absent (duck-typed, matches an SDK edge case) never expires', () => {
  const mockTx = { sequence: '101', timeBounds: undefined };
  assert.equal(computeMultisigLifecycleStatus(mockTx, '100', now + 10_000_000), null);
});

test('accountSequence === null with an expired timebound still reports expired (the two checks are independent)', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now - 60), null, now), 'expired');
});

// --- priority: obsolete_seq wins when both are true --------------------------

test('obsolete_seq takes priority over expired when a transaction is both sequence-dead and time-expired', () => {
  assert.equal(computeMultisigLifecycleStatus(buildTx('100', now - 60), '500', now), 'obsolete_seq');
});

// --- E2E scenario: two parallel jobs of the same account ---------------------
// Job A and Job B are both built against the same starting sequence (as they
// would be if a user opened two "send payment" flows before either
// completed). Job A gets submitted first, consuming the sequence slot -
// job B's frozen transaction is now provably dead, without ever touching the
// job store/HTTP layer (which server.js cannot be tested through directly -
// see the file header).
test('two parallel jobs of the same account: after job A submits, job B is correctly detected as obsolete_seq', () => {
  const jobA = buildTx('900', now + 86400);
  const jobB = buildTx('900', now + 86400);
  assert.equal(jobA.sequence, jobB.sequence, 'sanity: job A and job B start from the identical baked-in sequence');

  assert.equal(
    computeMultisigLifecycleStatus(jobA, '900', now),
    null,
    'job A itself is (was, at submission time) still viable against the pre-submit account sequence'
  );

  // Job A submits successfully: the account's live sequence now equals what
  // job A's transaction carried.
  const accountSequenceAfterJobASubmit = jobA.sequence;
  assert.equal(
    computeMultisigLifecycleStatus(jobB, accountSequenceAfterJobASubmit, now),
    'obsolete_seq',
    'job B (same frozen sequence) must now be detected as obsolete_seq'
  );
});

// --- E2E scenario: expired timebound rejects new signatures -----------------
// A job built with a short window that nobody finished signing in time - the
// merge route (server.js) uses exactly this call to decide whether to accept
// one more incoming signature; a non-null result means "reject".
test('a job whose timebound passed while waiting for more signers is detected as expired - the merge route must reject any further signature for it', () => {
  const abandonedJob = buildTx('42', now - 1);
  assert.equal(computeMultisigLifecycleStatus(abandonedJob, '42', now), 'expired');
});

// --- extractMaxTimeUnix ------------------------------------------------------

test('extractMaxTimeUnix returns the exact configured maxTime', () => {
  assert.equal(extractMaxTimeUnix(buildTx('1', 12345)), 12345);
});

test('extractMaxTimeUnix returns 0 for an explicit maxTime of 0 (unbounded)', () => {
  assert.equal(extractMaxTimeUnix(buildTx('1', 0)), 0);
});

test('extractMaxTimeUnix returns 0 when timeBounds is entirely absent', () => {
  assert.equal(extractMaxTimeUnix({ timeBounds: undefined }), 0);
});

// --- mapSubmitResultCodeToLifecycleStatus ------------------------------------

test('mapSubmitResultCodeToLifecycleStatus maps tx_bad_seq to obsolete_seq', () => {
  assert.equal(mapSubmitResultCodeToLifecycleStatus('tx_bad_seq'), 'obsolete_seq');
});

test('mapSubmitResultCodeToLifecycleStatus maps tx_too_late to expired', () => {
  assert.equal(mapSubmitResultCodeToLifecycleStatus('tx_too_late'), 'expired');
});

test('mapSubmitResultCodeToLifecycleStatus returns null for an unrelated result code', () => {
  assert.equal(mapSubmitResultCodeToLifecycleStatus('tx_bad_auth'), null);
});

test('mapSubmitResultCodeToLifecycleStatus returns null for a missing result code', () => {
  assert.equal(mapSubmitResultCodeToLifecycleStatus(null), null);
  assert.equal(mapSubmitResultCodeToLifecycleStatus(undefined), null);
});
