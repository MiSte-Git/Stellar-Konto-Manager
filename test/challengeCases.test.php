<?php
// Offene Challenges eines Signers duerfen Dritte weder ueberschreiben noch verbrauchen (PHP).
// Faelle aus test/assets/challenge-cases.json, gleich in test/challengeCases.test.js. Echter
// HTTP-Test gegen api/multisig.php: Challenges holen, mit Nonce im Feld "challenge" gegen das
// Token einloesen. Frueher gab es je (jobId, signer) genau eine Challenge, POST /challenge
// ersetzte sie und token, decline, delete verbrauchten sie ohne Nonce im Body; die Szenarien
// (a), (b) und (e) schlagen mit dem alten Verhalten fehl. Signer aus vorbelegtem
// signers_cache_v2.json wie in test/multisigDecline.test.php.
//
// Run with: php test/challengeCases.test.php

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

const TEST_PORT = 3967;
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

$cases = json_decode((string)file_get_contents(__DIR__ . '/assets/challenge-cases.json'), true);
$owner = KeyPair::random();
$keys = ['S1' => KeyPair::random(), 'S2' => KeyPair::random()];
$now = time();
$tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();

function jobRow(string $id, KeyPair $owner, \Soneso\StellarSDK\Transaction $tx, int $now): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return [
        'id' => $id, 'accessToken' => "tok-{$id}", 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
        'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
        'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
    ];
}

$apiDir = sys_get_temp_dir() . '/skm-challenge-cases-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
// Je Szenario eigene Jobs, damit sich die Faelle nicht gegenseitig beeinflussen.
$items = [jobRow('body', $owner, $tx, $now)];
foreach ($cases['scenarios'] as $si => $_) {
    $items[] = jobRow("s{$si}-j1", $owner, $tx, $now);
    $items[] = jobRow("s{$si}-j2", $owner, $tx, $now);
}
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => $items]));
// fetchedAt in der Zukunft: bleibt fuer die ganze Testdauer frisch.
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [
            ['publicKey' => $owner->getAccountId(), 'weight' => 1],
            ['publicKey' => $keys['S1']->getAccountId(), 'weight' => 1],
            ['publicKey' => $keys['S2']->getAccountId(), 'weight' => 1],
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

$outcomeOf = [200 => 'ok', 400 => 'missing', 403 => 'invalid_signature'];

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    foreach ($cases['scenarios'] as $si => $scenario) {
        $jobs = ['j1' => "s{$si}-j1", 'j2' => "s{$si}-j2"];
        $nonces = [];
        $ok = true;
        $detail = '';
        foreach ($scenario['steps'] as $i => $step) {
            $pk = $keys[$step['signer']]->getAccountId();
            if ($step['op'] === 'create') {
                $res = request('POST', BASE_URL . "/{$jobs[$step['job']]}/challenge", [], ['signer' => $pk]);
                if ($res['status'] !== 200) { $ok = false; $detail .= ' [Schritt ' . ($i + 1) . ": Challenge {$res['status']}]"; }
                $nonces[$step['nonce']] = (string)($res['body']['challenge'] ?? '');
                continue;
            }
            $nonce = $nonces[$step['nonce']];
            $signWith = $step['sign'] === 'valid' ? $keys[$step['signer']] : KeyPair::random();
            $res = request('POST', BASE_URL . "/{$jobs[$step['job']]}/token", [], [
                'signer' => $pk, 'signature' => signNonce($signWith, $nonce, 'token'), 'challenge' => $nonce,
            ]);
            $outcome = $outcomeOf[$res['status']] ?? (string)$res['status'];
            $error = (string)($res['body']['error'] ?? '');
            $good = $outcome === $step['expect']
                && ($step['expect'] !== 'missing' || $error === 'challenge_missing_or_expired')
                && ($step['expect'] !== 'invalid_signature' || $error === 'invalid_signature')
                && ($step['expect'] !== 'ok' || ($res['body']['accessToken'] ?? '') === "tok-{$jobs[$step['job']]}");
            if (!$good) { $ok = false; $detail .= ' [Schritt ' . ($i + 1) . ": {$res['status']} {$error} statt {$step['expect']}]"; }
        }
        check("Fixture: {$scenario['name']}{$detail}", $ok);
    }

    // (f) fehlende oder kaputte Nonce im Body.
    $kp = $keys['S1'];
    $ch = request('POST', BASE_URL . '/body/challenge', [], ['signer' => $kp->getAccountId()]);
    $nonce = (string)($ch['body']['challenge'] ?? '');
    foreach ($cases['bodyNonces'] as $c) {
        $body = ['signer' => $kp->getAccountId(), 'signature' => signNonce($kp, $nonce, 'token')];
        if (empty($c['omit'])) $body['challenge'] = $c['value'];
        $res = request('POST', BASE_URL . '/body/token', [], $body);
        check("(f) Token mit Nonce \"{$c['label']}\" -> 400 challenge_missing_or_expired",
            $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    }
    // Ablehnen und Loeschen pruefen die Nonce genauso (Stichprobe wie in Node).
    foreach (['decline', 'delete'] as $action) {
        foreach ($cases['bodyNonces'] as $c) {
            if (!in_array($c['label'], ['fehlt', '22 Byte (F-6)', 'gueltig, aber unbekannt'], true)) continue;
            $body = ['signer' => $kp->getAccountId(), 'signature' => signNonce($kp, $nonce, $action)];
            if (empty($c['omit'])) $body['challenge'] = $c['value'];
            $res = request('POST', BASE_URL . "/body/{$action}", [], $body);
            check("(f) {$action} mit Nonce \"{$c['label']}\" -> 400 challenge_missing_or_expired",
                $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
        }
    }
    $res = request('POST', BASE_URL . '/body/token', [], ['signer' => $kp->getAccountId(), 'signature' => signNonce($kp, $nonce, 'token'), 'challenge' => $nonce]);
    check('(f) offene Challenge bleibt nach kaputten Nonces einloesbar -> 200', $res['status'] === 200 && ($res['body']['accessToken'] ?? '') === 'tok-body');

    // Ablehnen und Loeschen verbrauchen nur die mitgeschickte Nonce.
    $kp = $keys['S2'];
    $first = (string)(request('POST', BASE_URL . '/body/challenge', [], ['signer' => $kp->getAccountId()])['body']['challenge'] ?? '');
    $second = (string)(request('POST', BASE_URL . '/body/challenge', [], ['signer' => $kp->getAccountId()])['body']['challenge'] ?? '');
    $res = request('POST', BASE_URL . '/body/delete', [], ['signer' => $kp->getAccountId(), 'signature' => signNonce(KeyPair::random(), $first, 'delete'), 'challenge' => $first]);
    check('Loeschen mit falscher Signatur -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $res = request('POST', BASE_URL . '/body/decline', [], ['signer' => $kp->getAccountId(), 'signature' => signNonce($kp, $first, 'decline'), 'challenge' => $first]);
    check('dieselbe Nonce danach verbraucht -> 400', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    $res = request('POST', BASE_URL . '/body/decline', [], ['signer' => $kp->getAccountId(), 'signature' => signNonce($kp, $second, 'decline'), 'challenge' => $second]);
    check('zweite Nonce desselben Signers bleibt -> Ablehnen 200', $res['status'] === 200);
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
