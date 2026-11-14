<?php
// F-5 (PHP): Ein Signer mit Job-Token mergt eine zweite, andere gueltige Signatur seines Keys
// (anderes Nonce). Gespeichert bleibt je Signer nur eine Signatur (die schon gespeicherte), sonst
// lehnt das Netz die Transaktion spaeter mit tx_bad_auth_extra ab. Fixture
// test/assets/duplicate-signer-signatures.json, Signer aus vorbelegtem signers_cache_v2.json (A und B
// je Gewicht 1, Schwelle 2: es wird nicht gesendet). Pendant: test/duplicateSignerMerge.test.js.
//
// Run with: php test/duplicateSignerMerge.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) { $passed++; echo "\xE2\x9C\x94 {$description}\n"; }
    else { $failed++; echo "\xE2\x9C\x98 {$description}\n"; }
}

const TEST_PORT = 3950;
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

function waitFor(int $port): bool {
    for ($i = 0; $i < 100; $i++) {
        $socket = @fsockopen('127.0.0.1', $port);
        if ($socket) { fclose($socket); return true; }
        usleep(100000);
    }
    return false;
}

$dup = json_decode((string)file_get_contents(__DIR__ . '/assets/duplicate-signer-signatures.json'), true);
$a = KeyPair::fromAccountId($dup['publicKeyA']);
function withSigs(array $dup, KeyPair $a, array $list): string {
    $tx = AbstractTransaction::fromEnvelopeBase64XdrString($dup['txXdr']);
    $tx->setSignatures(array_map(fn($b64) => new XdrDecoratedSignature($a->getHint(), base64_decode($b64)), $list));
    return $tx->toEnvelopeXdrBase64();
}

$apiDir = sys_get_temp_dir() . '/skm-dupsig-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-dupsig-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');

$jobFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobFile, json_encode(['items' => [[
    'id' => 'dup-job', 'accessToken' => 'tok-dup', 'network' => 'testnet', 'accountId' => $dup['publicKeyA'],
    'txHash' => $dup['txHashHex'], 'txXdrOriginal' => $dup['txXdr'], 'txXdrCurrent' => withSigs($dup, $a, [$dup['signatureA1']]),
    'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => 0,
    'signers' => [['publicKey' => $dup['publicKeyA'], 'weight' => 1], ['publicKey' => $dup['publicKeyB'], 'weight' => 1]],
    'thresholds' => ['low' => 2, 'med' => 2, 'high' => 2],
    'requiredWeight' => 2, 'collectedSigners' => [['publicKey' => $dup['publicKeyA'], 'weight' => 1]], 'collectedWeight' => 1,
]]]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $dup['publicKeyA'] => [
        'data' => ['ok' => true, 'signers' => [['publicKey' => $dup['publicKeyA'], 'weight' => 1], ['publicKey' => $dup['publicKeyB'], 'weight' => 1]],
            'thresholds' => ['low' => 2, 'med' => 2, 'high' => 2], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));
$storedSignatures = function () use ($jobFile): array {
    $items = json_decode((string)file_get_contents($jobFile), true)['items'] ?? [];
    foreach ($items as $j) {
        if (($j['id'] ?? '') !== 'dup-job') continue;
        $tx = AbstractTransaction::fromEnvelopeBase64XdrString($j['txXdrCurrent']);
        return array_map(fn(XdrDecoratedSignature $s) => base64_encode($s->getSignature()), $tx->getSignatures());
    }
    return [];
};

$env = array_merge(getenv(), [
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
]);
$null = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'], $null, $p, $apiDir, $env);

try {
    check('sanity: PHP-Server laeuft', waitFor(TEST_PORT));

    $res = request('POST', BASE_URL . '/dup-job/merge-signed-xdr', ['x-job-token: tok-dup'], ['signedXdr' => withSigs($dup, $a, [$dup['signatureA2']])]);
    check('Merge zweite Signatur desselben Signers: 200 pending_signatures, Gewicht 1',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'pending_signatures' && ($res['body']['collectedWeight'] ?? null) === 1);
    check('Merge zweite Signatur desselben Signers: gespeichert bleibt nur die erste (wie Node)', $storedSignatures() === [$dup['signatureA1']]);

    $res = request('POST', BASE_URL . '/dup-job/merge-signed-xdr', ['x-job-token: tok-dup'], ['signedXdr' => withSigs($dup, $a, [$dup['signatureA2'], $dup['signatureA1']])]);
    check('Merge mit beiden Signaturen auf einmal: 200', $res['status'] === 200);
    check('Merge mit beiden Signaturen auf einmal: weiterhin nur eine (wie Node)', $storedSignatures() === [$dup['signatureA1']]);
} finally {
    proc_terminate($server);
    proc_close($server);
    @unlink($apiDir . '/vendor');
    foreach (glob($apiDir . '/data/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
    foreach (glob($sideDir . '/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir . '/data');
    @rmdir($apiDir);
    @rmdir($sideDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
