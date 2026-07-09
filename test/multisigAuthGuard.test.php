<?php
// Regression guards for api/multisig.php's DELETE and GET /jobs endpoints
// (analyse_multisig.md findings a1/a3). multisig.php isn't safely requireable
// in a test (it routes and exit()s as soon as it's loaded, same reason
// api/health.php/api/bugreport.php aren't required directly elsewhere in this
// suite - see test/healthCorsRegression.test.php) - so this checks the source
// directly for the specific patterns these fixes require, same approach as
// test/multisigSignersGuard.test.js does for server.js.
//
// Covers:
// - a1: DELETE /api/multisig/jobs used to require the real MULTISIG_ADMIN_TOKEN
//   only for mainnet ($net !== 'testnet'); testnet only needed a fixed confirm
//   string that's public knowledge (shown verbatim in the frontend's own UI),
//   i.e. no real auth check at all for a bulk wipe of every user's testnet
//   jobs. Both networks must now pass through the same unconditional
//   hash_equals(MULTISIG_ADMIN_TOKEN) gate before the network-specific
//   confirm string is even considered.
// - a3: GET /api/multisig/jobs without accountId or signer used to enumerate
//   every job of every account. It must now reject before any data is loaded.
//
// Run with: php test/multisigAuthGuard.test.php

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

$source = (string)file_get_contents(__DIR__ . '/../api/multisig.php');

// --- a1: DELETE /api/multisig/jobs ------------------------------------------
$deleteRouteIdx = strpos($source, "\$method === 'DELETE' && \$path === '/api/multisig/jobs'");
$fallbackIdx = strpos($source, '// Fallback', $deleteRouteIdx !== false ? $deleteRouteIdx : 0);
check('sanity: the DELETE /jobs route exists', $deleteRouteIdx !== false);
check('sanity: the DELETE route is followed by the routing fallback', $fallbackIdx !== false && $fallbackIdx > $deleteRouteIdx);

$deleteBlock = ($deleteRouteIdx !== false && $fallbackIdx !== false)
    ? substr($source, $deleteRouteIdx, $fallbackIdx - $deleteRouteIdx)
    : '';

$hashEqualsIdx = strpos($deleteBlock, 'hash_equals($requiredToken, $adminToken)');
check('DELETE route checks the real admin token via hash_equals()', $hashEqualsIdx !== false);

check(
    'the old network-conditional bypass (real auth only for non-testnet) is gone',
    strpos($deleteBlock, "if (\$net === 'testnet') {") === false
);

$expectedConfirmIdx = strpos($deleteBlock, '$expectedConfirm = $net === ');
check(
    'DELETE route still picks a network-specific confirm string as a second guard',
    $expectedConfirmIdx !== false
);
check(
    'the admin-token check runs unconditionally, before the network-specific confirm string is even chosen',
    $hashEqualsIdx !== false && $expectedConfirmIdx !== false && $hashEqualsIdx < $expectedConfirmIdx
);

// The unauthorized-401 response must be reachable regardless of which
// network was requested - i.e. it must not sit inside a branch keyed only on
// $net === 'public' (that would silently exempt testnet again).
$unauthorizedIdx = strpos($deleteBlock, "'error' => 'unauthorized'");
check('DELETE route can answer 401 unauthorized for either network', $unauthorizedIdx !== false && $unauthorizedIdx > $hashEqualsIdx);

// --- a3: GET /api/multisig/jobs ---------------------------------------------
$getListRouteIdx = strpos($source, "\$method === 'GET' && \$path === '/api/multisig/jobs'");
$getByIdRouteIdx = strpos($source, "'/api/multisig/jobs/:id'", $getListRouteIdx !== false ? $getListRouteIdx : 0);
check('sanity: the GET /jobs (list) route exists', $getListRouteIdx !== false);
check('sanity: the GET /jobs/:id route follows it', $getByIdRouteIdx !== false && $getByIdRouteIdx > $getListRouteIdx);

$getListBlock = ($getListRouteIdx !== false && $getByIdRouteIdx !== false)
    ? substr($source, $getListRouteIdx, $getByIdRouteIdx - $getListRouteIdx)
    : '';

$scopeGuardIdx = strpos($getListBlock, 'accountId_or_signer_required');
$loadJobsIdx = strpos($getListBlock, 'loadJobs($jobFile)');
check('GET /jobs rejects with accountId_or_signer_required when neither filter is given', $scopeGuardIdx !== false);
check('GET /jobs loads the job file at all (sanity)', $loadJobsIdx !== false);
check(
    'the scope guard runs before any job data is loaded - no data is ever touched for an unscoped request',
    $scopeGuardIdx !== false && $loadJobsIdx !== false && $scopeGuardIdx < $loadJobsIdx
);
check(
    'the guard is a hard rejection (400), not merely an empty-results filter',
    (bool)preg_match('/accountId_or_signer_required.{0,20}],\s*400\)/s', $getListBlock)
);

// --- a2: rate limiting + stale-job expiry are wired into this file ----------
check('multisig.php requires the new multisigJobsGuard.php module', strpos($source, "require __DIR__ . '/multisigJobsGuard.php'") !== false);
check('POST /jobs is rate-limited via multisigJobRateLimitCheckAndRecord()', strpos($source, 'multisigJobRateLimitCheckAndRecord(') !== false);
check('withJobsLock() expires stale pending jobs on every write', strpos($source, 'expireStalePendingJobs($items)') !== false);

$rateLimitIdx = strpos($source, 'multisigJobRateLimitCheckAndRecord($ip)');
$postJobsBodyIdx = strpos($source, '$body = jsonBody();', $deleteRouteIdx !== false ? 0 : 0);
check(
    'the rate limit is checked before the request body is even parsed (cheapest possible early-out)',
    $rateLimitIdx !== false && $postJobsBodyIdx !== false && $rateLimitIdx < $postJobsBodyIdx
);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
