<?php
// C1/R3: Loeschen in allen Endzustaenden (submitted_success, submitted_failed, obsolete_seq),
// PHP. test/multisigDelete.test.php deckt expired, rejected, offene Jobs und die abgelaufene
// Challenge ab. Echter HTTP-Test gegen api/multisig.php, Signer aus vorbelegtem
// signers_cache.json. Budget: 3 Challenges von 20 je Minute.
// Pendant: test/multisigDeleteStates.test.js (dort zusaetzlich die abgelaufene Challenge).
//
// Run with: php test/multisigDeleteStates.test.php

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

const TEST_PORT = 3937;
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

function deleteJob(string $jobId, KeyPair $signer): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $signer->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return request('POST', BASE_URL . "/{$jobId}/delete", [], [
        'signer' => $signer->getAccountId(),
        'signature' => base64_encode($signer->sign('skm:delete:' . $nonce)),
    ]);
}

$owner = KeyPair::random();
$b = KeyPair::random();
$now = time();
$tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();
$xdr = $tx->toEnvelopeXdrBase64();
$hash = bin2hex($tx->hash(Network::testnet()));
$row = fn(string $id, string $status): array => [
    'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
    'txHash' => $hash, 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
    'status' => $status, 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
    'requiredWeight' => 2, 'collectedSigners' => [], 'collectedWeight' => 0,
];

$apiDir = sys_get_temp_dir() . '/skm-states-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => [
    $row('gesendet', 'submitted_success'), $row('fehlgeschlagen', 'submitted_failed'), $row('veraltet', 'obsolete_seq'),
]]));
file_put_contents($apiDir . '/data/signers_cache.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [
            ['publicKey' => $owner->getAccountId(), 'weight' => 1], ['publicKey' => $b->getAccountId(), 'weight' => 1],
        ], 'thresholds' => ['low' => 1, 'med' => 2, 'high' => 2], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
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

    foreach (['gesendet' => 'submitted_success', 'fehlgeschlagen' => 'submitted_failed', 'veraltet' => 'obsolete_seq'] as $id => $status) {
        check("{$id} ({$status}) ist vorhanden", in_array($id, $storedIds(), true));
        $res = deleteJob($id, $b);
        check("Loeschen im Endzustand {$status} -> 200", $res['status'] === 200 && ($res['body']['ok'] ?? false) === true);
        check("{$id} ist aus der Datei entfernt", !in_array($id, $storedIds(), true));
    }
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
