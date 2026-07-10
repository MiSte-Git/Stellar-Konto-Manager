// Node parity to api/multisigJobsGuard.php's expireStalePendingJobs() -
// previously missing entirely (analyse_multisig.md b5 / the G5 time-window
// follow-up): a job left in a non-final state (pending_signatures/
// ready_to_submit) this long is realistically abandoned, and nothing else
// ever moves it out of that state on its own.
//
// A job whose baked-in timebound has already passed (maxTimeUnix, computed
// once from the transaction's timebounds when the job is created - see
// server.js's POST /jobs and merge-signed-xdr handlers) can never reach the
// network again, so it is marked 'expired' immediately rather than waiting
// on the age-based heuristic below. maxTimeUnix never changes after
// creation (merging only ever adds signatures, never alters
// sequence/timebounds), so this stays a pure, dependency-free comparison -
// no XDR parsing needed here, unlike the live sequence check the read path
// performs (which also needs a Horizon round-trip this lightweight guard
// deliberately avoids).
//
// The original age-based heuristic is kept as the fallback for jobs with no
// timebound at all (maxTimeUnix === 0 or missing) - either genuinely
// unbounded transactions or jobs stored before maxTimeUnix existed.
const PENDING_JOB_EXPIRY_DAYS = 7;

const FINAL_STATES = new Set(['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq']);

/**
 * @param {object[]} items
 * @param {number} [maxAgeDays]
 * @returns {object[]}
 */
function expireStalePendingJobs(items, maxAgeDays = PENDING_JOB_EXPIRY_DAYS) {
  const cutoffMs = Date.now() - maxAgeDays * 86400 * 1000;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return items.map((job) => {
    const status = job?.status || '';
    if (FINAL_STATES.has(status)) return job;

    const maxTimeUnix = Number(job?.maxTimeUnix || 0);
    if (maxTimeUnix !== 0) {
      return maxTimeUnix < nowSeconds ? { ...job, status: 'expired' } : job;
    }

    const createdAtMs = Date.parse(job?.createdAt || '');
    if (Number.isNaN(createdAtMs) || createdAtMs >= cutoffMs) return job;
    return { ...job, status: 'expired' };
  });
}

module.exports = { expireStalePendingJobs, PENDING_JOB_EXPIRY_DAYS };
