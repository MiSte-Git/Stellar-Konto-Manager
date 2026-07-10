// G5 stage 1 (time-window analysis follow-up to analyse_multisig.md b5):
// expired/obsolete_seq have existed as job-status labels since the H1/M1
// hardening round (badge in MultisigJobStatusBadge.jsx, i18n help text) but
// nothing ever computed them - a multisig job freezes its transaction's
// sequence number and timebounds at build time, then waits for asynchronous
// signers over a window that can span hours to days, and no code path ever
// checked whether the frozen transaction was still viable on-chain.
//
// This module is the single place both the read path (list/detail routes,
// called on every GET and after every merge) and the write-time stale-job
// guard (services/multisigJobsGuard.js) derive those two statuses from.
// Mirrors api/multisigLifecycle.php - keep both in sync.

// Determines whether a job's underlying transaction can still possibly reach
// the network successfully, given its baked-in sequence/timebounds and the
// account's current live sequence number. Returns null if the transaction is
// still viable (or viability can't be determined, e.g. accountSequence is
// unavailable and the transaction has no timebounds either).
//
// obsolete_seq takes priority over expired when both are true: it names the
// more specific cause (a competing transaction already consumed this job's
// sequence slot), whereas "expired" alone would suggest nothing else
// happened - which isn't the case once the sequence has moved on.
//
// @param {import('@stellar/stellar-sdk').Transaction} tx
// @param {string|null} accountSequence - the account's current live sequence number (string), or null if unknown
// @param {number} nowUnixSeconds
// @returns {'obsolete_seq'|'expired'|null}
function computeMultisigLifecycleStatus(tx, accountSequence, nowUnixSeconds) {
  if (accountSequence != null) {
    try {
      const txSeq = BigInt(tx.sequence);
      const accSeq = BigInt(accountSequence);
      if (txSeq <= accSeq) return 'obsolete_seq';
    } catch {
      // malformed sequence strings should never block the timebound check below
    }
  }

  const maxTimeUnix = extractMaxTimeUnix(tx);
  // 0 is Stellar's own convention for "no upper bound" (a maxTime XDR value
  // of 0), not year-1970 - never treat it as expired.
  if (maxTimeUnix !== 0 && maxTimeUnix < nowUnixSeconds) return 'expired';

  return null;
}

// Returns the transaction's maxTime as a unix timestamp (number), or 0 if it
// has no upper time bound (either no timeBounds precondition at all, or an
// explicit maxTime of "0"). Used both by computeMultisigLifecycleStatus()
// above and to precompute the maxTimeUnix field stored on a job at creation
// time, so the dependency-free expiry guard in multisigJobsGuard.js never
// needs to parse XDR itself.
// @param {import('@stellar/stellar-sdk').Transaction} tx
// @returns {number}
function extractMaxTimeUnix(tx) {
  const tb = tx && tx.timeBounds;
  if (!tb || !tb.maxTime) return 0;
  const n = Number(tb.maxTime);
  return Number.isFinite(n) ? n : 0;
}

// Horizon's problem+json extras.result_codes.transaction values that
// specifically indicate a dead-on-arrival job, as opposed to a generic
// submit failure - a safety net for the gap between our pre-submit lifecycle
// check (against a possibly up-to-30s-cached account sequence) and Horizon's
// actual, authoritative processing of the transaction.
// @param {string|null|undefined} resultCodeTransaction
// @returns {'obsolete_seq'|'expired'|null}
function mapSubmitResultCodeToLifecycleStatus(resultCodeTransaction) {
  if (resultCodeTransaction === 'tx_bad_seq') return 'obsolete_seq';
  if (resultCodeTransaction === 'tx_too_late') return 'expired';
  return null;
}

module.exports = {
  computeMultisigLifecycleStatus,
  extractMaxTimeUnix,
  mapSubmitResultCodeToLifecycleStatus,
};
