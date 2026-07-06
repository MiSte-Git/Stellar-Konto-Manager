<?php
// Regression guard for api/health.php's CORS hardening. health.php itself
// isn't safely requireable in a test (it attempts a real DB connection and
// exit()s as soon as it's loaded, same reason api/bugreport.php/trade.php
// aren't required directly elsewhere in this suite) - so, like
// test/serverCorsRegression.test.js does for server.js, this checks the
// source directly for the specific patterns this fix removes/requires, to
// catch a silent revert.
//
// Run with: php test/healthCorsRegression.test.php

declare(strict_types=1);

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

$healthSource = file_get_contents(__DIR__ . '/../api/health.php');

check(
    'health.php requires the shared cors.php module',
    (bool)preg_match('/require\s+__DIR__\s*\.\s*[\'"]\/cors\.php[\'"]/', $healthSource)
);

check(
    'health.php calls the shared apply_cors_headers() instead of building its own headers',
    strpos($healthSource, 'apply_cors_headers(') !== false
);

check(
    'health.php no longer hardcodes its own $allowedOrigins allowlist',
    strpos($healthSource, '$allowedOrigins') === false
);

check(
    'health.php no longer allows the retired x-admin-secret header',
    stripos($healthSource, 'x-admin-secret') === false
);

check(
    'the shared allowlist in cors.php still includes the prod origin health.php previously lacked',
    strpos((string)file_get_contents(__DIR__ . '/../api/cors.php'), 'skm.steei.de') !== false
);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
