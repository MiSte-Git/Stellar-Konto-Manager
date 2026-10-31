<?php
// #8: Das Job-Token gilt nur im Header x-job-token, nie als ?token= in der URL.
// Echter HTTP-Test gegen api/multisig.php (Pendant: test/multisigJobToken.test.js),
// Aufbau wie test/multisigAccountMismatch.test.php.
//
// Run with: php test/multisigJobToken.test.php

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
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n";
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n";
    }
}

const TEST_PORT = 3920;
const BASE_URL = 'http://127.0.0.1:' . TEST_PORT . '/api/multisig/jobs';
const TOKEN = 'token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function request(string $method, string $url, array $headers = [], ?array $body = null): int {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        $headers[] = 'Content-Type: application/json';
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_exec($ch);
    return (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
}

$owner = KeyPair::random();
$now = time();
$tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();
$xdr = $tx->toEnvelopeXdrBase64();

$apiDir = sys_get_temp_dir() . '/skm-token-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');

$job = [
    'id' => 'token-job',
    'accessToken' => TOKEN,
    'network' => 'testnet',
    'accountId' => $owner->getAccountId(),
    'txHash' => bin2hex($tx->hash(Network::testnet())),
    'txXdrOriginal' => $xdr,
    'txXdrCurrent' => $xdr,
    'status' => 'pending_signatures',
    'createdAt' => gmdate('c'),
    'maxTimeUnix' => $now + 3600,
    'signers' => [['publicKey' => $owner->getAccountId(), 'weight' => 1]],
    'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1],
    'requiredWeight' => 1,
    'collectedSigners' => [],
    'collectedWeight' => 0,
];
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [$job]]));

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

    $jobUrl = BASE_URL . '/token-job';
    check('Job-Abruf mit Token im Header -> 200', request('GET', $jobUrl, ['x-job-token: ' . TOKEN]) === 200);
    check('Job-Abruf mit ?token= statt Header -> 403 (wie Node)', request('GET', $jobUrl . '?token=' . TOKEN) === 403);
    check('Job-Abruf ohne Token -> 403', request('GET', $jobUrl) === 403);
    check('Merge mit ?token= statt Header -> 403', request('POST', $jobUrl . '/merge-signed-xdr?token=' . TOKEN, [], ['signedXdr' => $xdr]) === 403);
    check('Header zaehlt, falsches ?token= daneben wird ignoriert -> 200', request('GET', $jobUrl . '?token=falsch', ['x-job-token: ' . TOKEN]) === 200);
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
