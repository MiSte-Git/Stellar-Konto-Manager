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
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\BumpSequenceOperationBuilder;
use Soneso\StellarSDK\ClaimClaimableBalanceOperationBuilder;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\FeeBumpTransactionBuilder;
use Soneso\StellarSDK\MuxedAccount;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\PaymentOperationBuilder;
use Soneso\StellarSDK\SetOptionsOperationBuilder;
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

// --- operationThresholdCategory / requiredWeightForOperations --------------
// Bug fix (analyse_multisig.md b1): requiredWeight used to be hardcoded to
// med_threshold regardless of operation type. setOptions (what "Multisig
// bearbeiten" builds) is a High-threshold operation on the real Stellar
// protocol, so a job for it must require high_threshold, not med_threshold.

check('operationThresholdCategory classifies a SetOptionsOperation as high', operationThresholdCategory((new SetOptionsOperationBuilder())->setMasterKeyWeight(2)->build()) === 'high');
check('operationThresholdCategory classifies a PaymentOperation as medium', operationThresholdCategory((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build()) === 'med');
check('operationThresholdCategory classifies a BumpSequenceOperation as low', operationThresholdCategory((new BumpSequenceOperationBuilder(new BigInteger('101')))->build()) === 'low');
check('operationThresholdCategory classifies a ClaimClaimableBalanceOperation as low', operationThresholdCategory((new ClaimClaimableBalanceOperationBuilder(str_repeat('0', 8) . str_repeat('ab', 32)))->build()) === 'low');

function buildTxFor(array $operations): AbstractTransaction {
    $source = KeyPair::random();
    $account = new Account($source->getAccountId(), new BigInteger('100'));
    $builder = new TransactionBuilder($account);
    foreach ($operations as $op) $builder->addOperation($op);
    return $builder->build();
}

$setOptionsTx = buildTxFor([
    (new SetOptionsOperationBuilder())->setMasterKeyWeight(2)->build(),
    (new SetOptionsOperationBuilder())->setLowThreshold(1)->setMediumThreshold(2)->setHighThreshold(3)->build(),
]);
check(
    'requiredWeightForOperations uses high_threshold for a real setOptions-only transaction (the actual bug)',
    requiredWeightForOperations($setOptionsTx, ['low' => 1, 'med' => 2, 'high' => 3]) === 3
);

$paymentTx = buildTxFor([(new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build()]);
check(
    'requiredWeightForOperations uses med_threshold for a real payment-only transaction',
    requiredWeightForOperations($paymentTx, ['low' => 1, 'med' => 2, 'high' => 3]) === 2
);

$mixedTx = buildTxFor([
    (new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build(),
    (new SetOptionsOperationBuilder())->setMasterKeyWeight(2)->build(),
]);
check(
    'requiredWeightForOperations picks high over co-occurring medium (mixed payment + setOptions)',
    requiredWeightForOperations($mixedTx, ['low' => 1, 'med' => 2, 'high' => 3]) === 3
);

$lowMedTx = buildTxFor([
    (new BumpSequenceOperationBuilder(new BigInteger('101')))->build(),
    (new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build(),
]);
check(
    'requiredWeightForOperations picks medium over a co-occurring low-category operation',
    requiredWeightForOperations($lowMedTx, ['low' => 1, 'med' => 2, 'high' => 3]) === 2
);

check(
    'requiredWeightForOperations: high_threshold 0 faellt nicht auf med zurueck, max(low, 0, 1) = 1',
    requiredWeightForOperations($setOptionsTx, ['low' => 1, 'med' => 2, 'high' => 0]) === 1
);
check(
    'requiredWeightForOperations: med und high 0 ergibt low',
    requiredWeightForOperations($setOptionsTx, ['low' => 1, 'med' => 0, 'high' => 0]) === 1
);
check(
    'requiredWeightForOperations verlangt bei Schwellen 0 mindestens eine Signatur (Probe J)',
    requiredWeightForOperations($setOptionsTx, ['low' => 0, 'med' => 0, 'high' => 0]) === 1
);

// A FeeBumpTransaction has no getOperations() of its own (it wraps an inner
// Transaction) - requiredWeightForOperations() must degrade to the med-only
// fallback rather than throwing, exactly like the pre-fix behavior for an
// unparseable/operationless transaction.
$innerForBump = buildTxFor([(new SetOptionsOperationBuilder())->setMasterKeyWeight(2)->build()]);
$feeBumpTx = (new FeeBumpTransactionBuilder($innerForBump))
    ->setFeeAccount(KeyPair::random()->getAccountId())
    ->setBaseFee(100)
    ->build();
check(
    'requiredWeightForOperations falls back to med_threshold for a non-Transaction AbstractTransaction (e.g. FeeBumpTransaction)',
    requiredWeightForOperations($feeBumpTx, ['low' => 1, 'med' => 2, 'high' => 3]) === 2
);

// --- Gemeinsame Fixture (Node, PHP, Frontend) -------------------------------------------------
$opFixture = json_decode((string)file_get_contents(__DIR__ . '/assets/op-threshold-categories.json'), true);
check('Fixture op-threshold-categories geladen', is_array($opFixture['operations'] ?? null) && is_array($opFixture['requiredWeight'] ?? null));
foreach ($opFixture['operations'] as $op) {
    check("Fixture Kategorie {$op['phpClass']} = {$op['category']}", operationThresholdCategoryForClass($op['phpClass']) === $op['category']);
}
$opBuilders = [
    'bumpSequence' => fn() => (new BumpSequenceOperationBuilder(new BigInteger('101')))->build(),
    'claimClaimableBalance' => fn() => (new ClaimClaimableBalanceOperationBuilder(str_repeat('0', 8) . str_repeat('ab', 32)))->build(),
    'setOptions' => fn() => (new SetOptionsOperationBuilder())->setMasterKeyWeight(2)->build(),
    'payment' => fn() => (new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build(),
];
foreach ($opFixture['requiredWeight'] as $c) {
    $ops = array_map(fn($t) => $opBuilders[$t](), $c['ops']);
    check("Fixture requiredWeight {$c['label']} = {$c['expected']}", requiredWeightForOperations(buildTxFor($ops), $c['thresholds']) === $c['expected']);
}

// --- ADR 0013: fremde op.source-Konten (gemeinsame Fixture mit Node und Frontend) ---------------
$foreignFixture = json_decode((string)file_get_contents(__DIR__ . '/assets/foreign-op-sources.json'), true);
$fAddr = fn(string $name) => $foreignFixture['accounts'][$name];
$buildForeignTx = function (array $c) use ($fAddr): AbstractTransaction {
    $builder = new TransactionBuilder(new Account($fAddr('A'), new BigInteger('100')));
    foreach ($c['ops'] as $source) {
        $op = new PaymentOperationBuilder($fAddr('C'), Asset::native(), '1');
        if ($source !== null) $op->setMuxedSourceAccount(MuxedAccount::fromAccountId($fAddr($source)));
        $builder->addOperation($op->build());
    }
    $tx = $builder->build();
    if (!empty($c['feeBump'])) {
        $tx = (new FeeBumpTransactionBuilder($tx))->setFeeAccount($fAddr($c['feeSource']))->setBaseFee(200)->build();
    }
    // Ueber XDR wie im Backend (parseTx), nicht das gebaute Objekt.
    return AbstractTransaction::fromEnvelopeBase64XdrString($tx->toEnvelopeXdrBase64());
};
check('Fixture foreign-op-sources geladen', count($foreignFixture['cases'] ?? []) > 0);
foreach ($foreignFixture['cases'] as $c) {
    $expected = array_map($fAddr, $c['expected']);
    check("Fixture foreignOpSourcesOf: {$c['label']}", foreignOpSourcesOf($buildForeignTx($c), $fAddr('A')) === $expected);
    check("Fixture foreignOpSourcesOf: {$c['label']} (autoSubmit stimmig)", $c['autoSubmit'] === ($expected === []));
}
check('foreignOpSourcesOf: M-Adresse als Job-Konto, eigene Operationen nicht fremd',
    foreignOpSourcesOf($buildForeignTx(['ops' => ['A']]), $fAddr('A_M')) === []);
// Stub-Operation mit nicht bestimmbarem Basiskonto (MuxedAccount prueft nur das erste Zeichen), direkt ohne XDR.
$brokenSource = new MuxedAccount('GKAPUTT');
$stubTx = (new TransactionBuilder(new Account($fAddr('A'), new BigInteger('100'))))
    ->addOperation((new PaymentOperationBuilder($fAddr('C'), Asset::native(), '1'))->setMuxedSourceAccount($brokenSource)->build())
    ->addOperation((new PaymentOperationBuilder($fAddr('C'), Asset::native(), '1'))->setSourceAccount($fAddr('B'))->build())
    ->addOperation((new PaymentOperationBuilder($fAddr('C'), Asset::native(), '1'))->setMuxedSourceAccount($brokenSource)->build())
    ->addOperation((new PaymentOperationBuilder($fAddr('C'), Asset::native(), '1'))->setSourceAccount($fAddr('A'))->build())
    ->build();
check('foreignOpSourcesOf: Quelle ohne bestimmbares Basiskonto zaehlt als fremd (Rohwert, einmal), wie das Frontend',
    foreignOpSourcesOf($stubTx, $fAddr('A')) === ['GKAPUTT', $fAddr('B')]);

// --- F-5: je Signer hoechstens eine Signatur (die erste) --------------------
// Fixture: zwei verschiedene gueltige Signaturen desselben Keys A ueber denselben Hash (anderes
// Nonce). Gemeinsam mit test/txSignatures.test.js.
$dup = json_decode((string)file_get_contents(__DIR__ . '/assets/duplicate-signer-signatures.json'), true);
$dupKpA = KeyPair::fromAccountId($dup['publicKeyA']);
$dupKpB = KeyPair::fromSeed($dup['secretB']);
$dupSigners = [['publicKey' => $dup['publicKeyA'], 'weight' => 1], ['publicKey' => $dup['publicKeyB'], 'weight' => 1]];
function dupTx(array $dup, KeyPair $a, KeyPair $b, array $order): AbstractTransaction {
    $tx = AbstractTransaction::fromEnvelopeBase64XdrString($dup['txXdr']);
    $hash = $tx->hash(Network::testnet());
    $sigs = [
        'A1' => new XdrDecoratedSignature($a->getHint(), base64_decode($dup['signatureA1'])),
        'A2' => new XdrDecoratedSignature($a->getHint(), base64_decode($dup['signatureA2'])),
        'B' => new XdrDecoratedSignature($b->getHint(), $b->sign($hash)),
    ];
    $tx->setSignatures(array_map(fn($n) => $sigs[$n], $order));
    return $tx;
}
$dupSigB64 = fn(array $sigs) => array_map(fn(XdrDecoratedSignature $s) => base64_encode($s->getSignature()), $sigs);

$dupBase = AbstractTransaction::fromEnvelopeBase64XdrString($dup['txXdr']);
$dupHash = $dupBase->hash(Network::testnet());
check('F-5 sanity: Fixture-Hash passt', bin2hex($dupHash) === $dup['txHashHex']);
check('F-5 sanity: beide Signaturen von A sind gueltig und verschieden',
    $dupKpA->verifySignature(base64_decode($dup['signatureA1']), $dupHash)
    && $dupKpA->verifySignature(base64_decode($dup['signatureA2']), $dupHash)
    && $dup['signatureA1'] !== $dup['signatureA2']);
check('F-5: zwei gueltige Signaturen desselben Signers ergeben eine, die erste (A1, A2)',
    $dupSigB64(filterValidSignatures(dupTx($dup, $dupKpA, $dupKpB, ['A1', 'A2']), NET, $dupSigners)) === [$dup['signatureA1']]);
check('F-5: die erste bleibt auch in umgekehrter Reihenfolge (A2, A1)',
    $dupSigB64(filterValidSignatures(dupTx($dup, $dupKpA, $dupKpB, ['A2', 'A1']), NET, $dupSigners)) === [$dup['signatureA2']]);
$dupTx3 = dupTx($dup, $dupKpA, $dupKpB, ['A1', 'B', 'A2']);
$dupKept3 = $dupSigB64(filterValidSignatures($dupTx3, NET, $dupSigners));
check('F-5: andere Signer bleiben, Reihenfolge bleibt (A1, B, A2)',
    $dupKept3 === [$dup['signatureA1'], base64_encode($dupTx3->getSignatures()[1]->getSignature())]);
// Merge-Weg: gespeichert A1, eingehend A2 -> mergeSignatures behaelt beide (andere Bytes), der Filter nur A1.
$dupTarget = dupTx($dup, $dupKpA, $dupKpB, ['A1']);
$dupMerged = mergeSignatures($dupTarget, dupTx($dup, $dupKpA, $dupKpB, ['A2']));
check('F-5 sanity: mergeSignatures behaelt beide (Duplikat nur ueber gleiche Bytes)', count($dupMerged->getSignatures()) === 2);
$dupMerged->setSignatures(filterValidSignatures($dupMerged, NET, $dupSigners));
check('F-5: nach Merge und Filter bleibt die gespeicherte Signatur A1', $dupSigB64($dupMerged->getSignatures()) === [$dup['signatureA1']]);
check('F-5: gesammeltes Gewicht bleibt gleich (A einmal)', verifyCollected($dupMerged, NET, $dupSigners) === [['publicKey' => $dup['publicKeyA'], 'weight' => 1]]);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
