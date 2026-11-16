<?php
// R-1 (review_challenge_opus.md): signer und signature nur als String (PHP). Faelle aus
// test/assets/challenge-cases.json (bodyTypes), gleich in test/challengeBodyTypes.test.js.
// Vorher castete PHP signer an challenge und token sowie die Token-signature per (string);
// eine Liste wurde zu "Array" (mit Warnung) und ergab 403 statt 400. Eigene Datei und eigener
// Server: test/challengeCases.test.php braucht schon 17 der 20 POST /challenge je Minute und IP.
//
// Run with: php test/challengeBodyTypes.test.php

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

const TEST_PORT = 3969;
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

function signNonce(KeyPair $kp, string $nonceB64, string $purpose): string {
    return base64_encode($kp->sign('skm:' . $purpose . ':' . (string)base64_decode($nonceB64, true)));
}

// "$VALID" in der Fixture durch einen gueltigen Wert ersetzen, auch in Listen und Objekten.
function fill($value, string $valid) {
    if ($value === '$VALID') return $valid;
    if (is_array($value)) return array_map(fn($v) => fill($v, $valid), $value);
    return $value;
}

$cases = json_decode((string)file_get_contents(__DIR__ . '/assets/challenge-cases.json'), true);
$owner = KeyPair::random();
$signer = KeyPair::random();
$now = time();
$tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();
$xdr = $tx->toEnvelopeXdrBase64();

$apiDir = sys_get_temp_dir() . '/skm-challenge-types-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [[
    'id' => 'typen', 'accessToken' => 'tok-typen', 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
    'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
    'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
    'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
]]]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [
            ['publicKey' => $owner->getAccountId(), 'weight' => 1],
            ['publicKey' => $signer->getAccountId(), 'weight' => 1],
        ], 'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1], 'sequence' => '100'],
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

    $nonce = base64_encode(str_repeat("\0", 32));
    foreach ($cases['bodyTypes']['values'] as $c) {
        $value = fill($c['value'], $signer->getAccountId());
        $res = request('POST', BASE_URL . '/typen/challenge', [], ['signer' => $value]);
        check("signer \"{$c['label']}\" an challenge -> 400 invalid_signer", $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_signer');
        foreach (['token', 'decline', 'delete'] as $action) {
            $res = request('POST', BASE_URL . "/typen/{$action}", [], ['signer' => $value, 'signature' => signNonce($signer, $nonce, $action), 'challenge' => $nonce]);
            check("signer \"{$c['label']}\" an {$action} -> 400 invalid_signer", $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_signer');
        }
    }

    $ch = request('POST', BASE_URL . '/typen/challenge', [], ['signer' => $signer->getAccountId()]);
    $open = (string)($ch['body']['challenge'] ?? '');
    foreach ($cases['bodyTypes']['values'] as $c) {
        foreach (['token', 'decline', 'delete'] as $action) {
            $value = fill($c['value'], signNonce($signer, $open, $action));
            $res = request('POST', BASE_URL . "/typen/{$action}", [], ['signer' => $signer->getAccountId(), 'signature' => $value, 'challenge' => $open]);
            check("signature \"{$c['label']}\" an {$action} -> 400 missing_signature", $res['status'] === 400 && ($res['body']['error'] ?? '') === 'missing_signature');
        }
    }
    $res = request('POST', BASE_URL . '/typen/token', [], ['signer' => $signer->getAccountId(), 'signature' => signNonce($signer, $open, 'token'), 'challenge' => $open]);
    check('die Nonce bleibt dabei offen -> Token 200', $res['status'] === 200 && ($res['body']['accessToken'] ?? '') === 'tok-typen');
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
