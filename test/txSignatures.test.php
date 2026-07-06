<?php
// Lightweight, dependency-free test script for api/txSignatures.php (mirrors
// test/challengeStore.test.php - see the comment there for why this project
// uses plain PHP scripts instead of PHPUnit for the API side).
//
// Covers:
// - M1 (garbage/excess signatures on merge): filterValidSignatures() drops
//   anything that doesn't verify against a real account signer and caps the
//   result at Stellar's 20-signature protocol limit.
// - H2 (client-supplied collected/weight data): verifyCollected() is now the
//   sole source of truth for collected weight in both multisig.php routes -
//   there is no parameter (here or in the routes) through which a caller can
//   inject a (publicKey, weight) pair without an actual matching signature.
//
// Run with: php test/txSignatures.test.php

declare(strict_types=1);

require __DIR__ . '/../api/txSignatures.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\BumpSequenceOperationBuilder;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\TransactionBuilder;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;
use phpseclib3\Math\BigInteger;

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

const NET = 'testnet';

function buildUnsignedTxXdr(): string {
    $source = KeyPair::random();
    $account = new Account($source->getAccountId(), new BigInteger('100'));
    $op = (new BumpSequenceOperationBuilder(new BigInteger('101')))->build();
    return (new TransactionBuilder($account))->addOperation($op)->build()->toEnvelopeXdrBase64();
}

function parseUnsigned(string $xdr): AbstractTransaction {
    return AbstractTransaction::fromEnvelopeBase64XdrString($xdr);
}

function signerEntry(KeyPair $kp, int $weight = 1): array {
    return ['publicKey' => $kp->getAccountId(), 'weight' => $weight];
}

function garbageSignature(): XdrDecoratedSignature {
    return new XdrDecoratedSignature(random_bytes(4), random_bytes(64));
}

// --- verifyCollected: only counts signers who actually signed -------------
$unsignedXdr1 = buildUnsignedTxXdr();
$signerA = KeyPair::random();
$signerB = KeyPair::random();
$network = Network::testnet();

$tx1 = parseUnsigned($unsignedXdr1);
$tx1->sign($signerA, $network); // only A signs
$signers1 = [signerEntry($signerA, 3), signerEntry($signerB, 5)];
$collected1 = verifyCollected($tx1, NET, $signers1);
check(
    'verifyCollected only includes the signer who actually signed',
    count($collected1) === 1 && $collected1[0]['publicKey'] === $signerA->getAccountId() && $collected1[0]['weight'] === 3
);

// --- H2 regression: a signer "claimed" with weight but who never signed ---
// contributes nothing - there is no clientCollected/body parameter anymore
// through which a caller could assert {publicKey: B, weight: 5} without B's
// actual signature being present on the transaction.
$collectedWeight1 = array_sum(array_column($collected1, 'weight'));
check(
    "H2: signer B's claimed weight (5) is excluded since B never signed - total is A's weight only (3)",
    $collectedWeight1 === 3
);

// --- verifyCollected: a real signature from a key NOT in the signer list --
// contributes nothing either (an authentic signature is not enough - it must
// belong to a currently-known account signer).
$impostor = KeyPair::random();
$tx2 = parseUnsigned($unsignedXdr1);
$tx2->sign($impostor, $network);
$collected2 = verifyCollected($tx2, NET, [signerEntry($signerA, 3), signerEntry($signerB, 5)]);
check(
    'verifyCollected ignores a genuine signature from a key that is not a known signer',
    count($collected2) === 0
);

// --- filterValidSignatures: drops a garbage signature, keeps genuine ones --
$unsignedXdr3 = buildUnsignedTxXdr();
$tx3 = parseUnsigned($unsignedXdr3);
$tx3->sign($signerA, $network);
$tx3->sign($signerB, $network);
$withGarbage = $tx3->getSignatures();
$withGarbage[] = garbageSignature();
$tx3->setSignatures($withGarbage);
check('sanity: tx3 has 3 signatures before filtering (2 genuine + 1 garbage)', count($tx3->getSignatures()) === 3);

$filtered3 = filterValidSignatures($tx3, NET, [signerEntry($signerA), signerEntry($signerB)]);
check('filterValidSignatures drops the garbage signature, keeping exactly the 2 genuine ones', count($filtered3) === 2);

// --- filterValidSignatures: caps at MAX_TX_SIGNATURES even when every ------
// signature is individually genuine (22 distinct real signers).
$unsignedXdr4 = buildUnsignedTxXdr();
$tx4 = parseUnsigned($unsignedXdr4);
$manySigners = [];
for ($i = 0; $i < 22; $i++) {
    $kp = KeyPair::random();
    $tx4->sign($kp, $network);
    $manySigners[] = signerEntry($kp);
}
check('sanity: tx4 collected 22 genuine signatures before capping', count($tx4->getSignatures()) === 22);
$filtered4 = filterValidSignatures($tx4, NET, $manySigners);
check('filterValidSignatures caps the result at MAX_TX_SIGNATURES (20) even for all-genuine input', count($filtered4) === MAX_TX_SIGNATURES);

// --- mergeSignatures: unions two partially-signed copies, no duplicates ---
$unsignedXdr5 = buildUnsignedTxXdr();
$target = parseUnsigned($unsignedXdr5);
$target->sign($signerA, $network);
$incoming = parseUnsigned($unsignedXdr5);
$incoming->sign($signerB, $network);

$merged5 = mergeSignatures($target, $incoming);
check('mergeSignatures unions signatures from both copies', count($merged5->getSignatures()) === 2);

// Merging the same incoming signature again must not duplicate it.
$incomingAgain = parseUnsigned($unsignedXdr5);
$incomingAgain->sign($signerB, $network);
$merged5b = mergeSignatures($merged5, $incomingAgain);
check('mergeSignatures deduplicates a signature that is already present', count($merged5b->getSignatures()) === 2);

// --- end-to-end: merge -> filter (M1) -> verifyCollected (H2), garbage in --
// the incoming XDR never survives to influence collectedWeight.
$unsignedXdr6 = buildUnsignedTxXdr();
$target6 = parseUnsigned($unsignedXdr6);
$target6->sign($signerA, $network);
$incoming6 = parseUnsigned($unsignedXdr6);
$incoming6->sign($signerB, $network);
$incomingSigs = $incoming6->getSignatures();
$incomingSigs[] = garbageSignature();
$incoming6->setSignatures($incomingSigs);

$merged6 = mergeSignatures($target6, $incoming6);
$knownSigners6 = [signerEntry($signerA, 4), signerEntry($signerB, 6)];
$merged6->setSignatures(filterValidSignatures($merged6, NET, $knownSigners6));
check('end-to-end: garbage signature from the incoming XDR is stripped before persisting', count($merged6->getSignatures()) === 2);
$collected6 = verifyCollected($merged6, NET, $knownSigners6);
$collectedWeight6 = array_sum(array_column($collected6, 'weight'));
check('end-to-end: collectedWeight reflects exactly A+B (4+6=10), unaffected by the garbage signature', $collectedWeight6 === 10);

// --- H2 static regression guard: the vulnerable field must stay gone -------
$multisigSource = file_get_contents(__DIR__ . '/../api/multisig.php');
check(
    "regression guard: api/multisig.php no longer references 'clientCollected' anywhere",
    $multisigSource !== false && strpos($multisigSource, 'clientCollected') === false
);

// --- empty-signer-list guard (M1 follow-up): a failed Horizon lookup during
// merge must abort the request, never run filterValidSignatures() against an
// empty list (which would wipe every collected signature from txXdrCurrent).
// multisig.php routes and exits on require, so - same approach as the
// clientCollected guard above - these check the source for the specific
// patterns the fix requires.
$mergeRouteIdx = strpos($multisigSource, "matchRoute(\$path, '/api/multisig/jobs/:id/merge-signed-xdr')");
$guardIdx = strpos($multisigSource, '$signersUnavailable = true;');
$filterIdx = strpos($multisigSource, 'filterValidSignatures($merged');
check(
    'regression guard: merge route has the empty-signers abort, positioned before filterValidSignatures()',
    $mergeRouteIdx !== false && $guardIdx !== false && $filterIdx !== false
        && $mergeRouteIdx < $guardIdx && $guardIdx < $filterIdx
);
check(
    'regression guard: the empty-signers abort surfaces as a signers_unavailable error response',
    strpos($multisigSource, "sendError('signers_unavailable'") !== false
);
check(
    "regression guard: fetchAccountSigners() marks failed lookups with 'ok' => false",
    strpos($multisigSource, "'ok' => false, 'signers' => []") !== false
);
// The failure marker only helps if the cache layer honors it: a cached
// failure would otherwise be served for the full TTL, re-triggering the
// empty-list abort for 30s after a single transient Horizon hiccup.
$cacheWriteIdx = strpos($multisigSource, "if ((\$data['ok'] ?? true) !== false) {");
$cacheSaveIdx = $cacheWriteIdx !== false ? strpos($multisigSource, 'saveSignersCache($cacheFile, $cache);', $cacheWriteIdx) : false;
check(
    'regression guard: fetchAccountSignersCached() skips the cache write for failed lookups',
    $cacheWriteIdx !== false && $cacheSaveIdx !== false
);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
