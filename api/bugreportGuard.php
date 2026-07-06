<?php
// Input-hardening helpers for api/bugreport.php's public, unauthenticated
// "create report" action. Split out from bugreport.php (same reason as
// api/ssrfGuard.php was split from trade.php) so test/bugreportGuard.test.php
// can exercise them directly, without bugreport.php's top-level routing code
// running to completion (and exiting) as soon as it's required.
declare(strict_types=1);

// N3: same free-text field cap the Node backend already applies (server.js'
// clamp()), so a client can't stuff megabytes of text into a single report.
const BUGREPORT_FIELD_MAX_LENGTH = 5000;

function clamp_field(string $value, int $maxLength = BUGREPORT_FIELD_MAX_LENGTH): string {
    return mb_substr($value, 0, $maxLength);
}

// N3: simple per-IP rate limit for the public, unauthenticated "create
// report" action - file-backed (same approach as api/admin.php's login
// lockout) so it survives across requests without needing a DB table.
const BUGREPORT_RATE_LIMIT_MAX = 10;
const BUGREPORT_RATE_LIMIT_WINDOW_SECONDS = 60;

function bugReportRateLimitPath(): string {
    // Same override convention as challengeStore.php's CHALLENGES_FILE_PATH,
    // so tests can point this at a throwaway file instead of the real
    // production one.
    $override = getenv('BUGREPORT_RATE_LIMIT_PATH');
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/bugreport_rate_limit.json';
}

// Records one request for $ip and returns the seconds to wait if that pushed
// $ip over the limit, 0 if the request is within budget.
function bugReportRateLimitCheckAndRecord(string $ip): int {
    $file = bugReportRateLimitPath();
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
            if (($now - $windowStart) > BUGREPORT_RATE_LIMIT_WINDOW_SECONDS) {
                unset($data[$key]);
            }
        }

        $entry = $data[$ip] ?? ['count' => 0, 'windowStart' => $now];
        if (($now - (int)$entry['windowStart']) > BUGREPORT_RATE_LIMIT_WINDOW_SECONDS) {
            $entry = ['count' => 0, 'windowStart' => $now];
        }
        $entry['count'] = (int)$entry['count'] + 1;
        $data[$ip] = $entry;
        @file_put_contents($file, json_encode($data));

        if ($entry['count'] > BUGREPORT_RATE_LIMIT_MAX) {
            $remaining = BUGREPORT_RATE_LIMIT_WINDOW_SECONDS - ($now - (int)$entry['windowStart']);
            return max($remaining, 1);
        }
        return 0;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}
