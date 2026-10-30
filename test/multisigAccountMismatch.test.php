<?php
// K1: Die Quelle eines Multisig-Jobs muss der Transaktion entsprechen.
// Echter HTTP-Test gegen api/multisig.php (Pendant: test/multisigAccountMismatch.test.js):
// multisig.php routet beim Laden und laesst sich nicht direkt einbinden, und sein
// Datenordner ist fest. Darum laeuft eine Kopie von api/*.php mit eigenem Datenordner
// im PHP-Entwicklungsserver. Alle Konten sind zufaellig und existieren nicht: Die
// Konto-Abfrage schlaegt online wie offline fehl, die Pruefungen brauchen Horizon nicht.
//
// Run with: php test/multisigAccountMismatch.test.php

declare(strict_types=1);

require __DIR__ . '/../api/txSignatures.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\FeeBumpTransactionBuilder;
use Soneso\StellarSDK\MuxedAccount;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\PaymentOperationBuilder;
use Soneso\StellarSDK\TimeBounds;
use Soneso\StellarSDK\TransactionBuilder;
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

const TEST_PORT = 3918;
const BASE_URL = 'http://127.0.0.1:' . TEST_PORT . '/api/multisig/jobs';

function paymentTx(KeyPair $source, ?int $muxedId = null): \Soneso\StellarSDK\Transaction {
    $account = new Account($source->getAccountId(), new BigInteger(100), $muxedId);
    $op = (new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '9000'))->build();
    $now = time();
    return (new TransactionBuilder($account))
        ->addOperation($op)
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
}

function post(string $url, array $body, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($ch, CURLOPT_HTTPHEADER, array_merge(['Content-Type: application/json'], $headers));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $raw = curl_exec($ch);
    return ['status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => json_decode((string)$raw, true) ?? []];
}

function createJob(string $accountId, AbstractTransaction $tx): array {
    return post(BASE_URL, ['network' => 'testnet', 'accountId' => $accountId, 'txXdr' => $tx->toEnvelopeXdrBase64()]);
}

$attacker = KeyPair::random();
$victim = KeyPair::random();
$victimTx = paymentTx($victim);
$victimXdr = $victimTx->toEnvelopeXdrBase64();

// --- Helfer -------------------------------------------------------------------

$plain = KeyPair::random();
check('txSourceBaseAccount: G-Adresse', txSourceBaseAccount(paymentTx($plain)) === $plain->getAccountId());
check('txSourceBaseAccount: M-Adresse zaehlt zum Basiskonto', txSourceBaseAccount(paymentTx($plain, 7)) === $plain->getAccountId());
$inner = paymentTx($plain);
$inner->sign($plain, Network::testnet());
$feeBump = (new FeeBumpTransactionBuilder($inner))->setFeeAccount(KeyPair::random()->getAccountId())->setBaseFee(200)->build();
check('txSourceBaseAccount: Fee-Bump nimmt die innere Transaktion', txSourceBaseAccount($feeBump) === $plain->getAccountId());

// --- HTTP-Ablauf --------------------------------------------------------------

$apiDir = sys_get_temp_dir() . '/skm-k1-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');

// Altjob von vor dem Fix: gespeichertes accountId weicht von der Tx-Quelle ab.
$legacyJob = [
    'id' => 'legacy-mismatch',
    'accessToken' => 'legacy-token',
    'network' => 'testnet',
    'accountId' => $attacker->getAccountId(),
    'txHash' => bin2hex($victimTx->hash(Network::testnet())),
    'txXdrOriginal' => $victimXdr,
    'txXdrCurrent' => $victimXdr,
    'status' => 'pending_signatures',
    'createdAt' => gmdate('c'),
    'maxTimeUnix' => time() + 3600,
    'signers' => [['publicKey' => $victim->getAccountId(), 'weight' => 1]],
    'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1],
    'requiredWeight' => 1,
    'collectedSigners' => [],
    'collectedWeight' => 0,
];
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [$legacyJob]]));

$server = proc_open(
    [PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir
);

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    $res = createJob($attacker->getAccountId(), $victimTx);
    check('Create: abweichende Quelle -> 400 (Szenario K1)', $res['status'] === 400);
    check('Create: gleicher Fehler und Text wie Node', $res['body'] === ['ok' => false, 'error' => 'account_mismatch', 'detail' => 'Transaction source does not match accountId.']);

    $invalid = ['', 'kaputt', 42, paymentTx($victim, 7)->getSourceAccount()->getAccountId(), substr($victim->getAccountId(), 0, -1) . 'A'];
    foreach ($invalid as $accountId) {
        $res = post(BASE_URL, ['network' => 'testnet', 'accountId' => $accountId, 'txXdr' => $victimXdr]);
        check('Create: accountId ' . var_export($accountId, true) . ' -> invalid_account', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_account');
    }

    $base = KeyPair::random();
    $res = createJob($base->getAccountId(), paymentTx($base, 7));
    check('Create: M-Adresse mit gleichem Basiskonto wird angenommen', $res['status'] === 200 && ($res['body']['accountId'] ?? '') === $base->getAccountId());

    $res = createJob($attacker->getAccountId(), paymentTx($victim, 7));
    check('Create: M-Adresse mit anderem Basiskonto wird abgelehnt', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'account_mismatch');

    $signed = AbstractTransaction::fromEnvelopeBase64XdrString($victimXdr);
    $signed->sign($victim, Network::testnet());
    $res = post(BASE_URL . '/legacy-mismatch/merge-signed-xdr', ['signedXdr' => $signed->toEnvelopeXdrBase64()], ['x-job-token: legacy-token']);
    check('Merge: Altjob mit Abweichung -> 400 account_mismatch', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'account_mismatch');

    $stored = json_decode((string)file_get_contents($apiDir . '/data/multisig_jobs.json'), true);
    $legacy = array_values(array_filter($stored['items'] ?? [], fn($j) => ($j['id'] ?? '') === 'legacy-mismatch'))[0] ?? [];
    check('Merge: Altjob bleibt unveraendert gespeichert', ($legacy['txXdrCurrent'] ?? '') === $victimXdr);

    $owner = KeyPair::random();
    $ownerTx = paymentTx($owner);
    $created = createJob($owner->getAccountId(), $ownerTx);
    check('sanity: passender Job wird angelegt', $created['status'] === 200);
    $ownerSigned = AbstractTransaction::fromEnvelopeBase64XdrString($ownerTx->toEnvelopeXdrBase64());
    $ownerSigned->sign($owner, Network::testnet());
    $res = post(BASE_URL . '/' . ($created['body']['id'] ?? '') . '/merge-signed-xdr', ['signedXdr' => $ownerSigned->toEnvelopeXdrBase64()], ['x-job-token: ' . ($created['body']['accessToken'] ?? '')]);
    // Das Konto existiert nicht, der Merge endet deshalb erst bei der Signer-Abfrage.
    check('Merge: passender Job kommt an der Pruefung vorbei', $res['status'] === 502 && ($res['body']['error'] ?? '') === 'signers_unavailable');

    $res = post(BASE_URL . '/legacy-mismatch/merge-signed-xdr', ['signedXdr' => paymentTx($victim)->toEnvelopeXdrBase64()], ['x-job-token: legacy-token']);
    check('Merge: mismatched_hash kommt vor account_mismatch', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'mismatched_hash');

    // PHP parst Fee-Bumps und vergleicht die innere Quelle. Ein Fee-Bump hat selbst keine
    // Zeitgrenze und scheitert danach am Cap, Node lehnt schon beim Parsen als invalid_xdr ab.
    $feeOwner = KeyPair::random();
    $feeInner = paymentTx($feeOwner);
    $feeInner->sign($feeOwner, Network::testnet());
    $feeBumpTx = (new FeeBumpTransactionBuilder($feeInner))->setFeeAccount(KeyPair::random()->getAccountId())->setBaseFee(200)->build();

    $res = createJob($attacker->getAccountId(), $feeBumpTx);
    check('Fee-Bump: Create mit fremder innerer Quelle -> account_mismatch', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'account_mismatch');
    $res = createJob($feeOwner->getAccountId(), $feeBumpTx);
    check('Fee-Bump: Create mit passender innerer Quelle -> timebound_too_long', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'timebound_too_long');

    $created = createJob($feeOwner->getAccountId(), $feeInner);
    check('sanity: Job fuer die innere Transaktion wird angelegt', $created['status'] === 200);
    $res = post(BASE_URL . '/' . ($created['body']['id'] ?? '') . '/merge-signed-xdr', ['signedXdr' => $feeBumpTx->toEnvelopeXdrBase64()], ['x-job-token: ' . ($created['body']['accessToken'] ?? '')]);
    check('Fee-Bump: Merge in den Job der inneren Tx -> mismatched_hash', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'mismatched_hash');
} finally {
    proc_terminate($server);
    proc_close($server);
    unlink($apiDir . '/vendor');
    foreach (glob($apiDir . '/data/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir . '/data');
    @rmdir($apiDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
