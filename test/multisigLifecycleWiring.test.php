<?php
// Regression guards for how api/multisig.php and api/multisigJobsGuard.php
// wire in the G5 stage 1 lifecycle logic (api/multisigLifecycle.php - see
// test/multisigLifecycle.test.php for the actual decision-logic tests).
//
// multisig.php isn't safely requireable in a test (it routes and exit()s as
// soon as it's loaded - see test/multisigAuthGuard.test.php's header
// comment), so - same approach as that file - this checks the source
// directly for the specific patterns the G5 stage 1 change requires.
//
// Run with: php test/multisigLifecycleWiring.test.php

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

check('multisig.php requires the new multisigLifecycle.php module', strpos($source, "require __DIR__ . '/multisigLifecycle.php'") !== false);

// --- summarizeJob(): read-path lifecycle check --------------------------------

$summarizeIdx = strpos($source, 'function summarizeJob(array $job): array');
$routingIdx = strpos($source, "// Routing\n\$path = parse_url");
check('sanity: summarizeJob() exists', $summarizeIdx !== false);
check('sanity: routing section follows summarizeJob()', $routingIdx !== false && $routingIdx > $summarizeIdx);
$summarizeBlock = ($summarizeIdx !== false && $routingIdx !== false) ? substr($source, $summarizeIdx, $routingIdx - $summarizeIdx) : '';

// F2: the Horizon meta fetch must be conditioned on actually needing it -
// either the job isn't final yet (lifecycle check needs a live sequence), or
// the stored signers[] snapshot is empty (needs backfilling regardless of
// status). An already-final job with a populated signer snapshot must not
// trigger a Horizon round-trip it will never use.
$isFinalIdx = strpos($summarizeBlock, "\$isFinal = in_array(\$job['status'] ?? '', \$finalStates, true);");
$signersEmptyIdx = strpos($summarizeBlock, '$signersEmpty = !$signers || count($signers) === 0;');
$conditionedFetchIdx = strpos($summarizeBlock, '$meta = (!$isFinal || $signersEmpty) ? fetchAccountSignersCached($accountId, $net) : null;');
check('summarizeJob() determines finality up front', $isFinalIdx !== false);
check('summarizeJob() determines whether the signers snapshot is empty up front', $signersEmptyIdx !== false);
check(
    'F2: the account meta fetch is conditioned on (not final) or (signers empty), not unconditional',
    $conditionedFetchIdx !== false && $isFinalIdx !== false && $signersEmptyIdx !== false
        && $isFinalIdx < $conditionedFetchIdx && $signersEmptyIdx < $conditionedFetchIdx
);
check('summarizeJob() derives a BigInteger account sequence from the fetched meta', strpos($summarizeBlock, "new BigInteger(\$meta['sequence'])") !== false);
$lifecycleCallIdx = strpos($summarizeBlock, 'computeMultisigLifecycleStatus($tx, $accountSequence, time())');
$notFinalBranchIdx = strpos($summarizeBlock, 'if (!$isFinal) {');
check('summarizeJob() calls computeMultisigLifecycleStatus()', $lifecycleCallIdx !== false);
check(
    'the lifecycle check runs inside the not-already-final branch, and overrides the ready/pending computation',
    $notFinalBranchIdx !== false && $lifecycleCallIdx !== false && $lifecycleCallIdx > $notFinalBranchIdx
);

// --- GET /jobs (list): F3 - ?status= filters against the recomputed status ---

$listRouteIdx = strpos($source, "\$method === 'GET' && \$path === '/api/multisig/jobs'");
$listByIdRouteIdx = strpos($source, "'/api/multisig/jobs/:id'", $listRouteIdx !== false ? $listRouteIdx : 0);
check('sanity: the list route exists and precedes GET /jobs/:id', $listRouteIdx !== false && $listByIdRouteIdx !== false && $listByIdRouteIdx > $listRouteIdx);
$listBlock = ($listRouteIdx !== false && $listByIdRouteIdx !== false) ? substr($source, $listRouteIdx, $listByIdRouteIdx - $listRouteIdx) : '';

$prefilterIdx = strpos($listBlock, 'array_filter($items, function ($j) use ($net, $accountId, $signer) {');
check('F3: the pre-pagination filter no longer closes over $status', $prefilterIdx !== false);

$summarizeMapIdx = strpos($listBlock, "\$page = array_map('summarizeJob', \$page);");
$postFilterIdx = strpos($listBlock, 'array_values(array_filter($page, fn($j) => ($j[\'status\'] ?? \'\') === $status));');
check('sanity: the list route still maps summarizeJob() over the page', $summarizeMapIdx !== false);
check('F3: the ?status= filter is applied to the page after summarizeJob() recomputed each status', $postFilterIdx !== false);
check(
    'the status filter runs strictly after the summarizeJob() recomputation, not before',
    $summarizeMapIdx !== false && $postFilterIdx !== false && $postFilterIdx > $summarizeMapIdx
);

// --- POST /jobs (create): maxTimeUnix precomputed + G5 stage 2 cap check -----

$createRouteIdx = strpos($source, "\$method === 'POST' && \$path === '/api/multisig/jobs'");
$mergeRouteIdxForCreateScope = strpos($source, "\$method === 'POST' && (\$m = matchRoute(\$path, '/api/multisig/jobs/:id/merge-signed-xdr'))");
check('sanity: the create route exists', $createRouteIdx !== false);
check('sanity: the merge route follows the create route', $mergeRouteIdxForCreateScope !== false && $mergeRouteIdxForCreateScope > $createRouteIdx);
$createBlock = ($createRouteIdx !== false && $mergeRouteIdxForCreateScope !== false)
    ? substr($source, $createRouteIdx, $mergeRouteIdxForCreateScope - $createRouteIdx)
    : '';

check(
    'the create route precomputes and stores maxTimeUnix (reusing the cap-check variable) on the new job',
    strpos($createBlock, "'maxTimeUnix' => \$maxTimeUnix,") !== false
);

$capCheckIdx = strpos($createBlock, '$maxTimeUnix = extractMaxTimeUnix($tx);');
$capRejectIdx = strpos($createBlock, "'error' => 'timebound_too_long',");
$horizonFetchIdx = strpos($createBlock, '$meta = fetchAccountSignersCached($accountId, $net);');
check('G5 stage 2: the create route computes maxTimeUnix right after parsing the tx', $capCheckIdx !== false);
check('G5 stage 2: the create route rejects a too-long timebound with timebound_too_long', $capRejectIdx !== false);
check(
    'G5 stage 2: the cap check runs before any Horizon lookup - cheapest possible early-out',
    $capCheckIdx !== false && $horizonFetchIdx !== false && $capCheckIdx < $horizonFetchIdx
);
check(
    'the cap rejection precedes the Horizon lookup too',
    $capRejectIdx !== false && $horizonFetchIdx !== false && $capRejectIdx < $horizonFetchIdx
);
check(
    'the cap check calls isMultisigTimeboundWithinCap()',
    strpos($createBlock, 'isMultisigTimeboundWithinCap($maxTimeUnix, time())') !== false
);

// --- merge route: reject already-final jobs before any Horizon lookup --------

$mergeRouteIdx = strpos($source, "\$method === 'POST' && (\$m = matchRoute(\$path, '/api/multisig/jobs/:id/merge-signed-xdr'))");
check('sanity: the merge route exists', $mergeRouteIdx !== false);
$mergeBlock = $mergeRouteIdx !== false ? substr($source, $mergeRouteIdx) : '';

$maxTimeBackfillIdx = strpos($mergeBlock, "\$j['maxTimeUnix'] = extractMaxTimeUnix(\$current);");
$finalRejectIdx = strpos($mergeBlock, "\$lifecycleRejected = \$existingStatus;");
$fetchMetaIdx = strpos($mergeBlock, "\$meta = fetchAccountSignersCached(\$j['accountId'] ?? '', \$net);");
check('merge route backfills maxTimeUnix for jobs stored before the field existed', $maxTimeBackfillIdx !== false);
check('merge route rejects an already-final job immediately (lifecycleRejected)', $finalRejectIdx !== false);
check(
    'the already-final rejection runs before the (Horizon-costing) account meta fetch',
    $finalRejectIdx !== false && $fetchMetaIdx !== false && $finalRejectIdx < $fetchMetaIdx
);

$sequenceLifecycleIdx = strpos($mergeBlock, '$lifecycleStatus = computeMultisigLifecycleStatus($current, $accountSequence, time());');
$mergeSignaturesIdx = strpos($mergeBlock, '$merged = mergeSignatures($current, $incoming);');
check('merge route computes lifecycle status against the live account sequence', $sequenceLifecycleIdx !== false);
check(
    'the lifecycle check runs before mergeSignatures() ever touches the incoming signature',
    $sequenceLifecycleIdx !== false && $mergeSignaturesIdx !== false && $sequenceLifecycleIdx < $mergeSignaturesIdx
);

$rejectResponseIdx = strpos($mergeBlock, "if (\$lifecycleRejected) return sendJson(['ok' => false, 'error' => \$lifecycleRejected, 'job' => \$resultRow], 409);");
check('merge route responds with HTTP 409 and the rejection reason when the job is lifecycle-dead', $rejectResponseIdx !== false);

// --- merge route: submit-failure result-code mapping (TOCTOU safety net) -----

$submitCatchIdx = strpos($mergeBlock, 'catch (\Throwable $submitErr) {', $mergeSignaturesIdx !== false ? $mergeSignaturesIdx : 0);
$mappedIdx = strpos($mergeBlock, '$mapped = mapSubmitResultCodeToLifecycleStatus($resultCode);');
check('sanity: the merge route still has a submit-failure catch block', $submitCatchIdx !== false);
check('the submit-failure handler maps Horizon result codes to lifecycle statuses', $mappedIdx !== false);
check('the mapping happens inside the submit catch block, not elsewhere', $mappedIdx !== false && $submitCatchIdx !== false && $mappedIdx > $submitCatchIdx);
check(
    'a mapped result falls back to submitted_failed only when the mapping is null (TOCTOU safety net, not a replacement for the generic case)',
    strpos($mergeBlock, "\$status = \$mapped ?? 'submitted_failed';") !== false
);

// --- multisigJobsGuard.php: maxTimeUnix-based expiry --------------------------

$guardSource = (string)file_get_contents(__DIR__ . '/../api/multisigJobsGuard.php');
check(
    'expireStalePendingJobs() checks maxTimeUnix before falling back to the age-based heuristic',
    (bool)preg_match('/\$maxTimeUnix = \(int\)\(\$job\[.maxTimeUnix.\] \?\? 0\);\s*\n\s*if \(\$maxTimeUnix !== 0\)/s', $guardSource)
);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
