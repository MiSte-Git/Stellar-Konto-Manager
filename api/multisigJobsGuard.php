<?php
// Rate limiting + stale-job expiry for api/multisig.php's job store (analyse_multisig.md
// finding a2: unbounded job creation + pending jobs that never age out). Split
// out (same rationale as api/bugreportGuard.php/api/ssrfGuard.php) so
// test/multisigJobsGuard.test.php can exercise these directly, without
// multisig.php's top-level routing running to completion (and exiting) as
// soon as it's required.
declare(strict_types=1);

require_once __DIR__ . '/rateLimit.php';

// N-style per-IP rate limit for the public, unauthenticated "create job"
// action, ueber den gemeinsamen Limiter api/rateLimit.php (IPv6 je /64, eigene
// Datei, Pfad per MULTISIG_JOB_RATE_LIMIT_PATH ueberschreibbar). Job
// creation does a live Horizon lookup plus (if the threshold is already met)
// a real network submission, so it's meaningfully more expensive per request
// than a bugreport - the window is wider and the budget smaller accordingly.
const MULTISIG_JOB_RATE_LIMIT_MAX = 20;
const MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS = 300;

function multisigJobRateLimitPath(): string {
    return rateLimitPath('MULTISIG_JOB_RATE_LIMIT_PATH', 'multisig_job_rate_limit.json');
}

// Records one request for $ip and returns the seconds to wait if that pushed
// $ip over the limit, 0 if the request is within budget.
function multisigJobRateLimitCheckAndRecord(string $ip): int {
    return rateLimitCheckAndRecord(multisigJobRateLimitPath(), $ip, MULTISIG_JOB_RATE_LIMIT_MAX, MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS);
}

// R-8: GET /api/multisig/jobs (Liste nach accountId oder signer) je IP. Jede Liste kann
// Horizon-Abrufe ausloesen (Live-Neuberechnung, bis zu 5 Klaerungen bei submit_unclear).
// 60 je Minute: Das Frontend pollt nicht, es laedt die Liste nur beim Oeffnen, bei
// Filterwechsel, Aktualisieren, nach dem Schliessen eines Jobs und nach dem Loeschen, je
// hoechstens 2 Anfragen (accountId und signer). Gleiches Budget in server.js
// (services/rateLimit.js). Gezaehlt wird vor allen Pruefungen.
const MULTISIG_JOB_LIST_RATE_LIMIT_MAX = 60;
const MULTISIG_JOB_LIST_RATE_LIMIT_WINDOW_SECONDS = 60;

function multisigJobListRateLimitPath(): string {
    return rateLimitPath('MULTISIG_JOB_LIST_RATE_LIMIT_PATH', 'multisig_job_list_rate_limit.json');
}

function multisigJobListRateLimitCheckAndRecord(string $ip): int {
    return rateLimitCheckAndRecord(multisigJobListRateLimitPath(), $ip, MULTISIG_JOB_LIST_RATE_LIMIT_MAX, MULTISIG_JOB_LIST_RATE_LIMIT_WINDOW_SECONDS);
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
    $finalStates = ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'];
    $cutoff = time() - ($maxAgeDays * 86400);
    $now = time();
    foreach ($items as &$job) {
        $status = $job['status'] ?? '';
        if (in_array($status, $finalStates, true)) continue;
        // F-2: submit_unclear ist nicht final, darf hier aber nie expired werden. Die Transaktion kann im
        // Ledger sein; nur die Klaerung ueber Horizon beim Lesen setzt den Status (multisig.php).
        if ($status === 'submit_unclear') continue;

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
