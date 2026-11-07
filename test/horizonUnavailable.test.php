<?php
// R1/R2 (PHP): Token, Ablehnen und Loeschen unterscheiden "Konto unbekannt" (Horizon 404 ->
// 403 forbidden) von "Horizon nicht erreichbar" (-> 503 horizon_unavailable; vorher beides 403).
// Der Horizon-Zustand kommt aus einem vorbelegten signers_cache.json (ok => false, notFound
// true oder false), damit der Ablauf ohne Netz laeuft. R1: Der Guzzle-Client fuer Horizon hat
// Timeouts; das wird am Quelltext geprueft, weil sich ein haengendes Horizon im Test nicht
// ohne Netz erzeugen laesst. Budget: 6 Challenges von 20 je Minute.
// Pendant: test/horizonUnavailable.test.js
//
// Run with: php test/horizonUnavailable.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\PaymentOperationBuilder;
use Soneso\StellarSDK\TimeBounds;
use Soneso\StellarSDK\TransactionBuilder;
use phpseclib3\Math\BigInteger;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) { $passed++; echo "\xE2\x9C\x94 {$description}\n"; }
    else { $failed++; echo "\xE2\x9C\x98 {$description}\n"; }
}

const TEST_PORT = 3939;
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

function call(string $jobId, KeyPair $signer, string $action, string $purpose): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $signer->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return request('POST', BASE_URL . "/{$jobId}/{$action}", [], [
        'signer' => $signer->getAccountId(),
        'signature' => base64_encode($signer->sign("skm:{$purpose}:" . $nonce)),
    ]);
}

$signer = KeyPair::random();
$down = KeyPair::random();
$gone = KeyPair::random();
$now = time();
$tx = (new TransactionBuilder(new Account(KeyPair::random()->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();
$xdr = $tx->toEnvelopeXdrBase64();
$hash = bin2hex($tx->hash(Network::testnet()));
$row = fn(string $id, string $accountId): array => [
    'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $accountId,
    'txHash' => $hash, 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
    'status' => 'expired', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
    'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
];

$apiDir = sys_get_temp_dir() . '/skm-horizon-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => [$row('j-down', $down->getAccountId()), $row('j-gone', $gone->getAccountId())]]));
$failure = fn(bool $notFound): array => [
    'data' => ['ok' => false, 'notFound' => $notFound, 'signers' => [], 'thresholds' => ['low' => 0, 'med' => 0, 'high' => 0], 'sequence' => null],
    'fetchedAt' => time() + 3600,
];
file_put_contents($apiDir . '/data/signers_cache.json', json_encode([
    'testnet:' . $down->getAccountId() => $failure(false),
    'testnet:' . $gone->getAccountId() => $failure(true),
]));
$storedIds = function () use ($jobsFile): array {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    return array_map(fn($j) => $j['id'] ?? '', $data['items'] ?? []);
};

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

    foreach (['token' => 'token', 'decline' => 'decline', 'delete' => 'delete'] as $action => $purpose) {
        $res = call('j-down', $signer, $action, $purpose);
        check("{$action}: Horizon nicht erreichbar -> 503 horizon_unavailable", $res['status'] === 503 && $res['body'] === ['ok' => false, 'error' => 'horizon_unavailable']);
        $res = call('j-gone', $signer, $action, $purpose);
        check("{$action}: Konto bei Horizon unbekannt (404) -> 403 forbidden", $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    }
    check('Jobs nach den Fehlern unveraendert', $storedIds() === ['j-down', 'j-gone']);

    // R1: horizonClient() setzt Timeouts (Guzzle-Standard waere "kein Limit").
    $source = (string)file_get_contents(__DIR__ . '/../api/multisig.php');
    check('R1: horizonClient setzt connect_timeout und timeout',
        preg_match("/function horizonClient\(.*?'connect_timeout' => \d+,\s*'timeout' => HORIZON_LOAD_TIMEOUT_SECONDS/s", $source) === 1);
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
