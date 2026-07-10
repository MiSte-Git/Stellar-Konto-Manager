<?php
// Tests for api/multisigLifecycle.php (G5 stage 1: expired/obsolete_seq
// existed as job-status labels since the H1/M1 hardening round but nothing
// ever computed them - see analyse_multisig.md b5 and the follow-up
// time-window analysis). Mirrors test/multisigLifecycle.test.js - keep both
// in sync.
//
// multisig.php itself cannot be required directly in a test (it routes and
// exit()s as soon as it's loaded - see test/multisigAuthGuard.test.php's
// header comment), so the wiring of this logic into summarizeJob() and the
// merge/create routes is covered separately by source-pattern assertions in
// test/multisigLifecycleWiring.test.php. This file exercises the actual
// decision logic directly against real SDK-built Transaction objects - no
// Horizon network access required, same approach as test/txSignatures.test.php.
//
// Run with: php test/multisigLifecycle.test.php

declare(strict_types=1);

require __DIR__ . '/../api/multisigLifecycle.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\BumpSequenceOperationBuilder;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\TimeBounds;
use Soneso\StellarSDK\Transaction;
use Soneso\StellarSDK\TransactionBuilder;
use phpseclib3\Math\BigInteger;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n"; // ✔
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n"; // ✘
    }
}

// Builds a transaction from an account currently at $startSeq (BigInteger
// string), optionally with an explicit maxTime (unix seconds; omit for no
// timebounds at all, matching what a real .setTimeout()-built job always
// has, but letting us test the "no timebounds precondition" branch too).
function buildTx(string $startSeq, ?int $maxTimeUnix = null): Transaction {
    $source = KeyPair::random();
    $account = new Account($source->getAccountId(), new BigInteger($startSeq));
    $op = (new BumpSequenceOperationBuilder(new BigInteger($startSeq)))->build();
    $builder = (new TransactionBuilder($account))->addOperation($op);
    if ($maxTimeUnix !== null) {
        $builder->setTimeBounds(new TimeBounds(new \DateTime('@0'), new \DateTime('@' . $maxTimeUnix)));
    }
    return $builder->build();
}

$now = time();

// --- computeMultisigLifecycleStatus: sequence -------------------------------

check(
    'a transaction whose sequence is exactly one greater than the account sequence is viable (null)',
    computeMultisigLifecycleStatus(buildTx('100', $now + 3600), new BigInteger('100'), $now) === null
);

check(
    'a transaction whose sequence equals the current account sequence is obsolete_seq (already consumed)',
    computeMultisigLifecycleStatus(buildTx('100', $now + 3600), new BigInteger('101'), $now) === 'obsolete_seq'
);

check(
    'a transaction whose sequence is behind the current account sequence is obsolete_seq',
    computeMultisigLifecycleStatus(buildTx('100', $now + 3600), new BigInteger('500'), $now) === 'obsolete_seq'
);

check(
    'accountSequence === null (Horizon lookup unavailable) skips the sequence check entirely',
    computeMultisigLifecycleStatus(buildTx('100', $now + 3600), null, $now) === null
);

// --- computeMultisigLifecycleStatus: timebounds -----------------------------

check(
    'a transaction whose maxTime has already passed is expired',
    computeMultisigLifecycleStatus(buildTx('100', $now - 60), new BigInteger('100'), $now) === 'expired'
);

check(
    'a transaction whose maxTime is still in the future is not expired',
    computeMultisigLifecycleStatus(buildTx('100', $now + 60), new BigInteger('100'), $now) === null
);

check(
    'a transaction with an explicit maxTime of 0 (unbounded) never expires, even long "after" now',
    computeMultisigLifecycleStatus(buildTx('100', 0), new BigInteger('100'), $now + 10_000_000) === null
);

check(
    'a transaction with no timeBounds precondition at all (never called setTimeBounds) never expires',
    computeMultisigLifecycleStatus(buildTx('100', null), new BigInteger('100'), $now + 10_000_000) === null
);

check(
    'accountSequence === null with an expired timebound still reports expired (the two checks are independent)',
    computeMultisigLifecycleStatus(buildTx('100', $now - 60), null, $now) === 'expired'
);

// --- priority: obsolete_seq wins when both are true --------------------------

check(
    'obsolete_seq takes priority over expired when a transaction is both sequence-dead and time-expired',
    computeMultisigLifecycleStatus(buildTx('100', $now - 60), new BigInteger('500'), $now) === 'obsolete_seq'
);

// --- E2E scenario: two parallel jobs of the same account ---------------------
// Job A and Job B are both built against the same starting sequence (as they
// would be if a user opened two "send payment" flows before either
// completed). Job A gets submitted first, consuming the sequence slot -
// job B's frozen transaction is now provably dead, without ever touching the
// job store/HTTP layer (which multisig.php/server.js cannot be tested
// through directly - see the file header).
$jobA = buildTx('900', $now + 86400);
$jobB = buildTx('900', $now + 86400);
check('sanity: job A and job B start from the identical baked-in sequence', $jobA->getSequenceNumber()->toString() === $jobB->getSequenceNumber()->toString());

// Job A submits successfully: the account's live sequence now equals what
// job A's transaction carried.
$accountSequenceAfterJobASubmit = $jobA->getSequenceNumber();

check(
    'job A itself is (was, at submission time) still viable against the pre-submit account sequence',
    computeMultisigLifecycleStatus($jobA, new BigInteger('900'), $now) === null
);
check(
    'after job A submits, job B (same frozen sequence) is now correctly detected as obsolete_seq',
    computeMultisigLifecycleStatus($jobB, $accountSequenceAfterJobASubmit, $now) === 'obsolete_seq'
);

// --- E2E scenario: expired timebound rejects new signatures -----------------
// A job built with a short window that nobody finished signing in time - the
// merge route (api/multisig.php) uses exactly this call to decide whether to
// accept one more incoming signature; a non-null result means "reject".
$abandonedJob = buildTx('42', $now - 1);
check(
    'a job whose timebound passed while waiting for more signers is detected as expired - the merge route must reject any further signature for it',
    computeMultisigLifecycleStatus($abandonedJob, new BigInteger('42'), $now) === 'expired'
);

// --- extractMaxTimeUnix ------------------------------------------------------

check('extractMaxTimeUnix returns the exact configured maxTime', extractMaxTimeUnix(buildTx('1', 12345)) === 12345);
check('extractMaxTimeUnix returns 0 for an explicit maxTime of 0 (unbounded)', extractMaxTimeUnix(buildTx('1', 0)) === 0);
check('extractMaxTimeUnix returns 0 when no timeBounds precondition was set at all', extractMaxTimeUnix(buildTx('1', null)) === 0);

// --- mapSubmitResultCodeToLifecycleStatus ------------------------------------

check('mapSubmitResultCodeToLifecycleStatus maps tx_bad_seq to obsolete_seq', mapSubmitResultCodeToLifecycleStatus('tx_bad_seq') === 'obsolete_seq');
check('mapSubmitResultCodeToLifecycleStatus maps tx_too_late to expired', mapSubmitResultCodeToLifecycleStatus('tx_too_late') === 'expired');
check('mapSubmitResultCodeToLifecycleStatus returns null for an unrelated result code', mapSubmitResultCodeToLifecycleStatus('tx_bad_auth') === null);
check('mapSubmitResultCodeToLifecycleStatus returns null for a missing result code', mapSubmitResultCodeToLifecycleStatus(null) === null);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
