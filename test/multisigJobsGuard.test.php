<?php
// Lightweight, dependency-free test script for api/multisigJobsGuard.php
// (same approach as test/bugreportGuard.test.php - see the comment there for
// why this project uses plain PHP scripts instead of PHPUnit for the API
// side).
//
// Covers analyse_multisig.md finding a2 (unbounded job creation + pending
// jobs that never age out):
// - per-IP rate limit on job creation (multisigJobRateLimitCheckAndRecord)
// - marking long-abandoned pending/ready jobs 'expired' (expireStalePendingJobs)
//
// Run with: php test/multisigJobsGuard.test.php

declare(strict_types=1);

$tmpRateLimitFile = sys_get_temp_dir() . '/multisig_job_rate_limit_test_' . getmypid() . '.json';
putenv('MULTISIG_JOB_RATE_LIMIT_PATH=' . $tmpRateLimitFile);

require __DIR__ . '/../api/multisigJobsGuard.php';

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

function cleanupRateLimitFiles(string $file): void {
    @unlink($file);
    @unlink($file . '.lock');
}

// --- multisigJobRateLimitCheckAndRecord ------------------------------------
cleanupRateLimitFiles($tmpRateLimitFile);

$ip = '203.0.113.42';
$blockedAt = null;
for ($i = 1; $i <= MULTISIG_JOB_RATE_LIMIT_MAX; $i++) {
    $retryAfter = multisigJobRateLimitCheckAndRecord($ip);
    if ($retryAfter > 0) {
        $blockedAt = $i;
        break;
    }
}
check(
    'multisigJobRateLimitCheckAndRecord allows requests up to MULTISIG_JOB_RATE_LIMIT_MAX (' . MULTISIG_JOB_RATE_LIMIT_MAX . ') within the window',
    $blockedAt === null
);

$overLimitRetryAfter = multisigJobRateLimitCheckAndRecord($ip);
check(
    'multisigJobRateLimitCheckAndRecord blocks the request once the per-IP limit is exceeded',
    $overLimitRetryAfter > 0 && $overLimitRetryAfter <= MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS
);

cleanupRateLimitFiles($tmpRateLimitFile);
$otherIp = '198.51.100.7';
for ($i = 0; $i < MULTISIG_JOB_RATE_LIMIT_MAX; $i++) {
    multisigJobRateLimitCheckAndRecord($ip);
}
$otherIpRetryAfter = multisigJobRateLimitCheckAndRecord($otherIp);
check(
    'multisigJobRateLimitCheckAndRecord tracks each IP independently (a different IP is unaffected)',
    $otherIpRetryAfter === 0
);

cleanupRateLimitFiles($tmpRateLimitFile);
$reusableIp = '198.51.100.99';
for ($i = 0; $i < MULTISIG_JOB_RATE_LIMIT_MAX; $i++) {
    multisigJobRateLimitCheckAndRecord($reusableIp);
}
$blocked = multisigJobRateLimitCheckAndRecord($reusableIp);
$raw = @file_get_contents($tmpRateLimitFile);
$data = $raw ? json_decode($raw, true) : null;
// Rewrite the stored window into the past to simulate the window having elapsed.
$data[$reusableIp]['windowStart'] = time() - MULTISIG_JOB_RATE_LIMIT_WINDOW_SECONDS - 1;
file_put_contents($tmpRateLimitFile, json_encode($data));
$afterWindowRetryAfter = multisigJobRateLimitCheckAndRecord($reusableIp);
check(
    'multisigJobRateLimitCheckAndRecord resets the counter once the time window has elapsed',
    $blocked > 0 && $afterWindowRetryAfter === 0
);

cleanupRateLimitFiles($tmpRateLimitFile);

// --- expireStalePendingJobs -------------------------------------------------

function jobAt(string $status, int $daysAgo): array {
    return [
        'id' => bin2hex(random_bytes(4)),
        'status' => $status,
        'createdAt' => gmdate('c', time() - ($daysAgo * 86400)),
    ];
}

$freshPending = jobAt('pending_signatures', 1);
$staleePending = jobAt('pending_signatures', PENDING_JOB_EXPIRY_DAYS + 1);
$staleReady = jobAt('ready_to_submit', PENDING_JOB_EXPIRY_DAYS + 5);
$freshSubmitted = jobAt('submitted_success', PENDING_JOB_EXPIRY_DAYS + 10);
$alreadyExpired = jobAt('expired', PENDING_JOB_EXPIRY_DAYS + 10);

$result = expireStalePendingJobs([$freshPending, $staleePending, $staleReady, $freshSubmitted, $alreadyExpired]);
$byId = [];
foreach ($result as $j) { $byId[$j['id']] = $j; }

check(
    'expireStalePendingJobs leaves a recently-created pending job untouched',
    $byId[$freshPending['id']]['status'] === 'pending_signatures'
);
check(
    'expireStalePendingJobs marks a stale pending_signatures job as expired',
    $byId[$staleePending['id']]['status'] === 'expired'
);
check(
    'expireStalePendingJobs marks a stale ready_to_submit job as expired too',
    $byId[$staleReady['id']]['status'] === 'expired'
);
check(
    'expireStalePendingJobs never touches a job already in a final state (submitted_success)',
    $byId[$freshSubmitted['id']]['status'] === 'submitted_success'
);
check(
    'expireStalePendingJobs is a no-op on a job already marked expired',
    $byId[$alreadyExpired['id']]['status'] === 'expired'
);

// A job right at the boundary (exactly PENDING_JOB_EXPIRY_DAYS old) is not yet
// stale - only strictly older than the window counts.
$boundaryJob = jobAt('pending_signatures', PENDING_JOB_EXPIRY_DAYS);
$boundaryResult = expireStalePendingJobs([$boundaryJob]);
check(
    'expireStalePendingJobs does not expire a job exactly at the boundary age',
    $boundaryResult[0]['status'] === 'pending_signatures'
);

// A job with a missing/unparseable createdAt must never be expired by this
// function (fail closed - never destroy data due to a malformed timestamp).
$noCreatedAt = ['id' => bin2hex(random_bytes(4)), 'status' => 'pending_signatures', 'createdAt' => 'not-a-date'];
$noCreatedAtResult = expireStalePendingJobs([$noCreatedAt]);
check(
    'expireStalePendingJobs leaves a job with an unparseable createdAt untouched',
    $noCreatedAtResult[0]['status'] === 'pending_signatures'
);

// --- G5 stage 1: maxTimeUnix-based expiry ------------------------------------
// A job's baked-in timebound (precomputed once at creation/merge time into
// maxTimeUnix - see multisig.php) takes priority over the age-based
// heuristic above: a job can be marked expired the moment its timebound
// passes, long before PENDING_JOB_EXPIRY_DAYS would otherwise kick in.

function jobWithMaxTime(string $status, int $maxTimeUnix, int $daysAgo = 0): array {
    return [
        'id' => bin2hex(random_bytes(4)),
        'status' => $status,
        'createdAt' => gmdate('c', time() - ($daysAgo * 86400)),
        'maxTimeUnix' => $maxTimeUnix,
    ];
}

$justExpired = jobWithMaxTime('pending_signatures', time() - 3600); // 1h ago, job itself only 1h old
$justExpiredResult = expireStalePendingJobs([$justExpired]);
check(
    'a job whose maxTimeUnix has already passed is expired immediately, without waiting for PENDING_JOB_EXPIRY_DAYS',
    $justExpiredResult[0]['status'] === 'expired'
);

$stillValid = jobWithMaxTime('pending_signatures', time() + 3600, PENDING_JOB_EXPIRY_DAYS + 10); // old by age, but still valid by timebound
$stillValidResult = expireStalePendingJobs([$stillValid]);
check(
    'a job with a future maxTimeUnix is never expired by age, even far past PENDING_JOB_EXPIRY_DAYS (maxTimeUnix wins over the age heuristic)',
    $stillValidResult[0]['status'] === 'pending_signatures'
);

$unboundedOld = jobWithMaxTime('pending_signatures', 0, PENDING_JOB_EXPIRY_DAYS + 1); // maxTimeUnix=0 (unbounded) - falls back to age heuristic
$unboundedOldResult = expireStalePendingJobs([$unboundedOld]);
check(
    'a job with maxTimeUnix=0 (no upper bound) falls back to the age-based heuristic and does get expired once stale',
    $unboundedOldResult[0]['status'] === 'expired'
);

$unboundedFresh = jobWithMaxTime('pending_signatures', 0, 1);
$unboundedFreshResult = expireStalePendingJobs([$unboundedFresh]);
check(
    'a job with maxTimeUnix=0 (no upper bound) that is still fresh by age is left untouched',
    $unboundedFreshResult[0]['status'] === 'pending_signatures'
);

$readyExpired = jobWithMaxTime('ready_to_submit', time() - 1);
$readyExpiredResult = expireStalePendingJobs([$readyExpired]);
check(
    'a ready_to_submit job past its maxTimeUnix is expired too, not just pending_signatures ones',
    $readyExpiredResult[0]['status'] === 'expired'
);

$finalUntouched = jobWithMaxTime('submitted_success', time() - 100000);
$finalUntouchedResult = expireStalePendingJobs([$finalUntouched]);
check(
    'a job already in a final state is never touched, regardless of maxTimeUnix',
    $finalUntouchedResult[0]['status'] === 'submitted_success'
);

// Legacy jobs stored before maxTimeUnix existed (field entirely absent, not
// just 0) must fall back to the age heuristic exactly like maxTimeUnix=0.
$legacyNoField = ['id' => bin2hex(random_bytes(4)), 'status' => 'pending_signatures', 'createdAt' => gmdate('c', time() - (PENDING_JOB_EXPIRY_DAYS + 1) * 86400)];
$legacyNoFieldResult = expireStalePendingJobs([$legacyNoField]);
check(
    'a legacy job with no maxTimeUnix field at all falls back to the age heuristic',
    $legacyNoFieldResult[0]['status'] === 'expired'
);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
