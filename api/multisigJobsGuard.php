<?php
// Rate limiting + stale-job expiry for api/multisig.php's job store (analyse_multisig.md
// finding a2: unbounded job creation + pending jobs that never age out). Split
// out (same rationale as api/bugreportGuard.php/api/ssrfGuard.php) so
// test/multisigJobsGuard.test.php can exercise these directly, without
// multisig.php's top-level routing running to completion (and exiting) as
// soon as it's required.
declare(strict_types=1);

// N-style per-IP rate limit for the public, unauthenticated "create job"
// action - file-backed (same approach as api/bugreportGuard.php's report rate
// limit) so it survives across requests without needing a DB table. Job
// creation does a live Horizon lookup plus (if the threshold is already met)
// a real network submission, so it's meaningfully more expensive per request
// than a bugreport - the window is wider and the budget smaller accordingly.
const MULTISIG_JOB_RATE_LIMIT_MAX = 20;
const MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS = 300;

function multisigJobRateLimitPath(): string {
    // Same override convention as challengeStore.php's CHALLENGES_FILE_PATH,
    // so tests can point this at a throwaway file instead of the real one.
    $override = getenv('MULTISIG_JOB_RATE_LIMIT_PATH');
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/multisig_job_rate_limit.json';
}

// Records one request for $ip and returns the seconds to wait if that pushed
// $ip over the limit, 0 if the request is within budget.
function multisigJobRateLimitCheckAndRecord(string $ip): int {
    $file = multisigJobRateLimitPath();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) return 0; // fail open on the rate limiter itself
    flock($lockHandle, LOCK_EX);
    try {
        $data = [];
        if (file_exists($file)) {
            $raw = @file_get_contents($file);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) $data = $decoded;
        }

        $now = time();
        foreach ($data as $key => $entry) {
            $windowStart = (int)($entry['windowStart'] ?? 0);
            if (($now - $windowStart) > MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS) {
                unset($data[$key]);
            }
        }

        $entry = $data[$ip] ?? ['count' => 0, 'windowStart' => $now];
        if (($now - (int)$entry['windowStart']) > MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS) {
            $entry = ['count' => 0, 'windowStart' => $now];
        }
        $entry['count'] = (int)$entry['count'] + 1;
        $data[$ip] = $entry;
        @file_put_contents($file, json_encode($data));

        if ($entry['count'] > MULTISIG_JOB_RATE_LIMIT_MAX) {
            $remaining = MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS - ($now - (int)$entry['windowStart']);
            return max($remaining, 1);
        }
        return 0;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

// A job left in a non-final state (pending_signatures/ready_to_submit) this
// long is realistically abandoned - nothing else ever moves it out of that
// state, so without this it would sit in multisig_jobs.json forever. Marking
// it 'expired' (a status the frontend/i18n already recognize) makes that
// visible to whoever created it, rather than silently deleting their
// in-progress signature collection. pruneOldJobs()'s existing
// JOB_RETENTION_DAYS window then purges it from disk like any other
// final-state job, once it's had time to actually be seen in that state (7
// days to expire, 30 more before physical removal).
//
// G5 stage 1: a job whose baked-in timebound (maxTimeUnix, computed once
// from the transaction's timebounds at creation - see multisig.php's POST
// /jobs and merge-signed-xdr routes) has already passed can never reach the
// network again, so it is expired immediately rather than waiting on the
// age-based heuristic below. maxTimeUnix never changes after creation
// (merging only ever adds signatures, never alters sequence/timebounds), so
// this stays a pure, dependency-free comparison - no XDR parsing/SDK needed
// in this file, unlike the live sequence check that multisig.php's
// summarizeJob() performs (which also needs a Horizon round-trip this
// lightweight guard deliberately avoids).
//
// The original age-based heuristic is kept as the fallback for jobs with no
// timebound at all (maxTimeUnix === 0 or missing) - either genuinely
// unbounded transactions or jobs stored before maxTimeUnix existed.
const PENDING_JOB_EXPIRY_DAYS = 7;

function expireStalePendingJobs(array $items, int $maxAgeDays = PENDING_JOB_EXPIRY_DAYS): array {
    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'];
    $cutoff = time() - ($maxAgeDays * 86400);
    $now = time();
    foreach ($items as &$job) {
        $status = $job['status'] ?? '';
        if (in_array($status, $finalStates, true)) continue;

        $maxTimeUnix = (int)($job['maxTimeUnix'] ?? 0);
        if ($maxTimeUnix !== 0) {
            if ($maxTimeUnix < $now) $job['status'] = 'expired';
            continue;
        }

        $createdAt = strtotime((string)($job['createdAt'] ?? ''));
        if ($createdAt === false || $createdAt >= $cutoff) continue;
        $job['status'] = 'expired';
    }
    unset($job);
    return $items;
}
