<?php
// Lightweight, dependency-free test script for api/bugreportGuard.php (same
// approach as test/ssrfGuard.test.php - see the comment there for why this
// project uses plain PHP scripts instead of PHPUnit for the API side).
//
// Covers:
// - N3 field-length clamp (clamp_field), matching server.js' 5000-char clamp()
// - N3 per-IP rate limit (bugReportRateLimitCheckAndRecord), using
//   BUGREPORT_RATE_LIMIT_PATH to point at a throwaway file instead of the
//   real api/data/bugreport_rate_limit.json
//
// Run with: php test/bugreportGuard.test.php

declare(strict_types=1);

$tmpRateLimitFile = sys_get_temp_dir() . '/bugreport_rate_limit_test_' . getmypid() . '.json';
putenv('BUGREPORT_RATE_LIMIT_PATH=' . $tmpRateLimitFile);

require __DIR__ . '/../api/bugreportGuard.php';

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

// --- clamp_field --------------------------------------------------------
check('clamp_field leaves a short string untouched', clamp_field('hello') === 'hello');
check('clamp_field caps a long string at 5000 characters', mb_strlen(clamp_field(str_repeat('a', 6000))) === 5000);
check('clamp_field respects a custom max length', clamp_field('abcdef', 3) === 'abc');
check(
    'clamp_field counts multi-byte characters, not bytes (does not split a UTF-8 sequence)',
    clamp_field(str_repeat('ü', 5001)) === str_repeat('ü', 5000)
);

// --- bugReportRateLimitCheckAndRecord -----------------------------------
cleanupRateLimitFiles($tmpRateLimitFile);

$ip = '203.0.113.42';
$blockedAt = null;
for ($i = 1; $i <= BUGREPORT_RATE_LIMIT_MAX; $i++) {
    $retryAfter = bugReportRateLimitCheckAndRecord($ip);
    if ($retryAfter > 0) {
        $blockedAt = $i;
        break;
    }
}
check(
    'bugReportRateLimitCheckAndRecord allows requests up to BUGREPORT_RATE_LIMIT_MAX (' . BUGREPORT_RATE_LIMIT_MAX . ') within the window',
    $blockedAt === null
);

$overLimitRetryAfter = bugReportRateLimitCheckAndRecord($ip);
check(
    'bugReportRateLimitCheckAndRecord blocks the request once the per-IP limit is exceeded',
    $overLimitRetryAfter > 0 && $overLimitRetryAfter <= BUGREPORT_RATE_LIMIT_WINDOW_SECONDS
);

cleanupRateLimitFiles($tmpRateLimitFile);
$otherIp = '198.51.100.7';
for ($i = 0; $i < BUGREPORT_RATE_LIMIT_MAX; $i++) {
    bugReportRateLimitCheckAndRecord($ip);
}
$otherIpRetryAfter = bugReportRateLimitCheckAndRecord($otherIp);
check(
    'bugReportRateLimitCheckAndRecord tracks each IP independently (a different IP is unaffected)',
    $otherIpRetryAfter === 0
);

cleanupRateLimitFiles($tmpRateLimitFile);
$reusableIp = '198.51.100.99';
for ($i = 0; $i < BUGREPORT_RATE_LIMIT_MAX; $i++) {
    bugReportRateLimitCheckAndRecord($reusableIp);
}
$blocked = bugReportRateLimitCheckAndRecord($reusableIp);
$raw = @file_get_contents($tmpRateLimitFile);
$data = $raw ? json_decode($raw, true) : null;
// Rewrite the stored window into the past to simulate the window having elapsed.
$data[$reusableIp]['windowStart'] = time() - BUGREPORT_RATE_LIMIT_WINDOW_SECONDS - 1;
file_put_contents($tmpRateLimitFile, json_encode($data));
$afterWindowRetryAfter = bugReportRateLimitCheckAndRecord($reusableIp);
check(
    'bugReportRateLimitCheckAndRecord resets the counter once the time window has elapsed',
    $blocked > 0 && $afterWindowRetryAfter === 0
);

cleanupRateLimitFiles($tmpRateLimitFile);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
