<?php
// G5 stage 1 (time-window analysis follow-up to analyse_multisig.md b5):
// expired/obsolete_seq have existed as job-status labels since the H1/M1
// hardening round (badge in MultisigJobStatusBadge.jsx, i18n help text) but
// nothing ever computed them - a multisig job freezes its transaction's
// sequence number and timebounds at build time, then waits for asynchronous
// signers over a window that can span hours to days, and no code path ever
// checked whether the frozen transaction was still viable on-chain.
//
// This file is the single place both the read path (summarizeJob() in
// multisig.php, called on every GET and after every merge) and the
// write-time stale-job guard (multisigJobsGuard.php) derive those two
// statuses from. Deliberately dependency-light beyond the SDK itself (no
// Horizon calls in here) so it stays trivially unit-testable, same rationale
// as txSignatures.php.
declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Transaction;
use phpseclib3\Math\BigInteger;

// Determines whether a job's underlying transaction can still possibly reach
// the network successfully, given its baked-in sequence/timebounds and the
// account's current live sequence number. Returns null if the transaction is
// still viable (or viability can't be determined, e.g. a fee-bump envelope
// this app never builds itself).
//
// obsolete_seq takes priority over expired when both are true: it names the
// more specific cause (a competing transaction already consumed this job's
// sequence slot), whereas "expired" alone would suggest nothing else
// happened - which isn't the case once the sequence has moved on.
function computeMultisigLifecycleStatus(AbstractTransaction $tx, ?BigInteger $accountSequence, int $nowUnixSeconds): ?string {
    if (!($tx instanceof Transaction)) return null;

    if ($accountSequence !== null && $tx->getSequenceNumber()->compare($accountSequence) <= 0) {
        return 'obsolete_seq';
    }

    $maxTimeUnix = extractMaxTimeUnix($tx);
    // 0 is Stellar's own convention for "no upper bound" (a maxTime XDR
    // value of 0), not year-1970 - never treat it as expired.
    if ($maxTimeUnix !== 0 && $maxTimeUnix < $nowUnixSeconds) {
        return 'expired';
    }

    return null;
}

// Returns the transaction's maxTime as a unix timestamp, or 0 if it has no
// upper time bound (either no timeBounds precondition at all, or an
// explicit maxTime of 0). Used both by computeMultisigLifecycleStatus()
// above and to precompute the maxTimeUnix field stored on a job at creation
// time, so the dependency-free expiry guard in multisigJobsGuard.php never
// needs to parse XDR itself.
function extractMaxTimeUnix(AbstractTransaction $tx): int {
    if (!($tx instanceof Transaction)) return 0;
    $timeBounds = $tx->getTimeBounds();
    if ($timeBounds === null) return 0;
    return (int)$timeBounds->getMaxTime()->format('U');
}

// Horizon's problem+json extras.result_codes.transaction values that
// specifically indicate a dead-on-arrival job, as opposed to a generic
// submit failure - a safety net for the gap between our pre-submit lifecycle
// check (against a possibly up-to-30s-cached account sequence, see
// fetchAccountSignersCached()) and Horizon's actual, authoritative
// processing of the transaction.
function mapSubmitResultCodeToLifecycleStatus(?string $resultCodeTransaction): ?string {
    if ($resultCodeTransaction === 'tx_bad_seq') return 'obsolete_seq';
    if ($resultCodeTransaction === 'tx_too_late') return 'expired';
    return null;
}

// G5 stage 2: the frontend's own multisigTimeoutSeconds setting
// (useSettings.js's MULTISIG_TIMEOUT_MAX_SECONDS) is clamped to 7 days
// client-side, but that's trivially bypassable (a direct POST to
// /api/multisig/jobs with a hand-built XDR) - a job that stays valid far
// longer than any realistic asynchronous-signing scenario is exactly the
// kind of long, drift-exposed window the G5 analysis flagged (P4: a fully
// signed transaction becomes a bearer instrument for however long its
// timebound allows). Enforced only at job creation, not on every merge -
// this is a creation-time policy gate, not an ongoing validity check (that
// remains computeMultisigLifecycleStatus()'s job).
const MULTISIG_JOB_MAX_TIMEBOUND_SECONDS = 604800; // 7 days
// Tolerates minor client/server clock drift around the cap boundary,
// mirroring the tolerant style of this app's other short timing windows
// (e.g. the 30s account-meta cache, the 60s challenge TTL) rather than
// rejecting a request over a few seconds of skew.
const MULTISIG_JOB_TIMEBOUND_GRACE_SECONDS = 300;

// An unbounded timebound (maxTimeUnix === 0) is never acceptable for a
// stored, asynchronously-signed job - it's the one case strictly worse than
// any capped duration, since it never ages out on its own at all. This
// app's own job-creation flows never produce one (getMultisigTxTimeout.js
// always sets a positive integer), so rejecting it only affects
// hand-crafted requests bypassing the client.
function isMultisigTimeboundWithinCap(int $maxTimeUnix, int $nowUnixSeconds): bool {
    if ($maxTimeUnix === 0) return false;
    return $maxTimeUnix <= $nowUnixSeconds + MULTISIG_JOB_MAX_TIMEBOUND_SECONDS + MULTISIG_JOB_TIMEBOUND_GRACE_SECONDS;
}
