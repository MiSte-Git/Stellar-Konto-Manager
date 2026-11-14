<?php
// Job-Datenmodell mit Signer-Typ (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 5), PHP.
// Echter HTTP-Test gegen api/multisig.php wie test/multisigDecline.test.php. Die Konto-Signer kommen aus
// einem vorbelegten signers_cache_v2.json; eine alte signers_cache.json wird nicht mehr gelesen.
// Pendant: test/multisigSignerType.test.js.
//
// Run with: php test/multisigSignerType.test.php
declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Crypto\StrKey;
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
        echo "\xE2\x9C\x94 {$description}\n";
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n";
    }
}

const TEST_PORT = 3945;
const BASE_URL = 'http://127.0.0.1:' . TEST_PORT . '/api/multisig/jobs';

function request(string $method, string $url, array $headers = [], ?array $body = null): array {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        $headers[] = 'Content-Type: application/json';
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $raw = curl_exec($ch);
    return ['status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => json_decode((string)$raw, true) ?? []];
}

$owner = KeyPair::random();
$b = KeyPair::random();
$x = StrKey::encodeSha256Hash(str_repeat("\x02", 32));
$now = time();

function paymentTx(KeyPair $owner, int $now): \Soneso\StellarSDK\Transaction {
    return (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
}

$oldTx = paymentTx($owner, $now);
$oldXdr = $oldTx->toEnvelopeXdrBase64();

$apiDir = sys_get_temp_dir() . '/skm-signertype-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');

// Altjob ohne Signer-Typ (Stand vor Teilschritt 5)
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [[
    'id' => 'altjob', 'accessToken' => 'tok-alt', 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
    'txHash' => bin2hex($oldTx->hash(Network::testnet())), 'txXdrOriginal' => $oldXdr, 'txXdrCurrent' => $oldXdr,
    'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
    'signers' => [['publicKey' => $owner->getAccountId(), 'weight' => 1], ['publicKey' => $x, 'weight' => 1]],
    'thresholds' => ['low' => 1, 'med' => 2, 'high' => 2],
    'requiredWeight' => 2, 'collectedSigners' => [], 'collectedWeight' => 0,
]]]));
$liveSigners = [
    ['publicKey' => $owner->getAccountId(), 'weight' => 1, 'type' => 'ed25519_public_key'],
    ['publicKey' => $b->getAccountId(), 'weight' => 1, 'type' => 'ed25519_public_key'],
    ['publicKey' => $x, 'weight' => 1, 'type' => 'sha256_hash'],
];
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => $liveSigners, 'thresholds' => ['low' => 1, 'med' => 2, 'high' => 2], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));
// Alte Cache-Datei ohne Typ und mit anderen Signern: darf nicht gelesen werden.
file_put_contents($apiDir . '/data/signers_cache.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [['publicKey' => KeyPair::random()->getAccountId(), 'weight' => 5]], 'thresholds' => ['low' => 0, 'med' => 0, 'high' => 0], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));

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

    $tx = paymentTx($owner, $now);
    $tx->sign($owner, Network::testnet());
    $res = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => $tx->toEnvelopeXdrBase64()]);
    check('Job anlegen -> 200', $res['status'] === 200);
    $jobId = (string)($res['body']['id'] ?? '');
    $token = (string)($res['body']['accessToken'] ?? '');
    $stored = null;
    foreach (json_decode((string)file_get_contents($apiDir . '/data/multisig_jobs.json'), true)['items'] ?? [] as $j) {
        if (($j['id'] ?? '') === $jobId) $stored = $j;
    }
    check('Job: signers mit Typ aus dem v2-Cache gespeichert (nicht aus der alten Datei)', ($stored['signers'] ?? null) === $liveSigners);
    check('Job: Erstsignatur des Owners gesammelt', count($stored['collectedSigners'] ?? []) === 1 && ($stored['collectedSigners'][0]['publicKey'] ?? '') === $owner->getAccountId());

    $detail = request('GET', BASE_URL . '/' . $jobId, ['x-job-token: ' . $token]);
    $missing = array_column($detail['body']['missingSigners'] ?? [], 'publicKey');
    check('missingSigners: nur b, der Hash-Signer fehlt nie', $missing === [$b->getAccountId()]);
    check('missingWeight: 1', (int)($detail['body']['missingWeight'] ?? -1) === 1);

    $alt = request('GET', BASE_URL . '/altjob', ['x-job-token: tok-alt']);
    $missingAlt = array_column($alt['body']['missingSigners'] ?? [], 'publicKey');
    check('Altjob ohne Signer-Typ: gelesen, Typ aus dem Schluessel, X-Signer fehlt nicht', $alt['status'] === 200 && $missingAlt === [$owner->getAccountId()]);
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
