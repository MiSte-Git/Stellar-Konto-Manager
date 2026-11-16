<?php
// Input-hardening helpers for api/bugreport.php's public, unauthenticated
// "create report" action. Split out from bugreport.php (same reason as
// api/ssrfGuard.php was split from trade.php) so test/bugreportGuard.test.php
// can exercise them directly, without bugreport.php's top-level routing code
// running to completion (and exiting) as soon as it's required.
declare(strict_types=1);

require_once __DIR__ . '/rateLimit.php';

// N3: same free-text field cap the Node backend already applies (server.js'
// clamp()), so a client can't stuff megabytes of text into a single report.
const BUGREPORT_FIELD_MAX_LENGTH = 5000;

function clamp_field(string $value, int $maxLength = BUGREPORT_FIELD_MAX_LENGTH): string {
    return mb_substr($value, 0, $maxLength);
}

// N3: simple per-IP rate limit for the public, unauthenticated "create
// report" action, ueber den gemeinsamen Limiter api/rateLimit.php (IPv6 je /64,
// eigene Datei, Pfad per BUGREPORT_RATE_LIMIT_PATH ueberschreibbar).
const BUGREPORT_RATE_LIMIT_MAX = 10;
const BUGREPORT_RATE_LIMIT_WINDOW_SECONDS = 60;

function bugReportRateLimitPath(): string {
    return rateLimitPath('BUGREPORT_RATE_LIMIT_PATH', 'bugreport_rate_limit.json');
}

// Records one request for $ip and returns the seconds to wait if that pushed
// $ip over the limit, 0 if the request is within budget.
function bugReportRateLimitCheckAndRecord(string $ip): int {
    return rateLimitCheckAndRecord(bugReportRateLimitPath(), $ip, BUGREPORT_RATE_LIMIT_MAX, BUGREPORT_RATE_LIMIT_WINDOW_SECONDS);
}
