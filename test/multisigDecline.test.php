<?php
// Feature 31.10.: Ablehnen einzelner Multisig-Jobs (PHP; Loeschen: test/multisigDelete.test.php), echter HTTP-Test gegen
// api/multisig.php wie test/multisigJobToken.test.php. Die Konto-Signer kommen aus einem
// vorbelegten signers_cache.json, damit der volle Ablauf ohne Horizon laeuft.
// Pendant: test/multisigDecline.test.js.
//
// Run with: php test/multisigDecline.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';
require __DIR__ . '/../api/multisigDecline.php';
require __DIR__ . '/../api/challengeStore.php';

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

// --- reine Logik (gleiche Faelle wie in Node) ---------------------------------
$sig = fn(...$w) => array_map(fn($weight, $i) => ['publicKey' => "S{$i}", 'weight' => $weight], $w, array_keys($w));
$r = applyDecline(['requiredWeight' => 2, 'status' => 'pending_signatures'], 'S1', $sig(1, 1, 1), 'now');
check('applyDecline: bleibt offen, solange das Gewicht reicht', $r['status'] === 'pending_signatures' && $r['possibleWeight'] === 2);
$r2 = applyDecline(['requiredWeight' => 2, 'status' => 'pending_signatures', 'declinedSigners' => $r['declinedSigners']], 'S2', $sig(1, 1, 1), 't2');
check('applyDecline: abgelehnt, wenn das Gewicht nicht mehr reicht', $r2['status'] === 'rejected');
$r3 = applyDecline(['requiredWeight' => 2, 'status' => 'pending_signatures', 'declinedSigners' => $r['declinedSigners']], 'S1', $sig(1, 1, 1), 't3');
check('applyDecline: doppelte Ablehnung zaehlt einmal', count($r3['declinedSigners']) === 1 && $r3['declinedSigners'][0]['at'] === 't3');
check('applyDecline: ohne requiredWeight nie abgelehnt', applyDecline(['requiredWeight' => 0, 'status' => 'pending_signatures'], 'S0', $sig(1), 'x')['status'] === 'pending_signatures');
check('dropDeclinesOfCollected', dropDeclinesOfCollected([['publicKey' => 'A'], ['publicKey' => 'B']], [['publicKey' => 'B']]) === [['publicKey' => 'A']]);

// --- HTTP -----------------------------------------------------------------------
const TEST_PORT = 3922;
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

function challengeFor(string $jobId, KeyPair $kp): string {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $kp->getAccountId()]);
    return base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
}

function decline(string $jobId, KeyPair $kp, ?KeyPair $signWith = null): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $kp->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true);
    $signature = base64_encode(($signWith ?? $kp)->sign('skm:decline:' . $nonce));
    return request('POST', BASE_URL . "/{$jobId}/decline", [], ['signer' => $kp->getAccountId(), 'signature' => $signature]);
}

$owner = KeyPair::random();
$b = KeyPair::random();
$c = KeyPair::random();
$stranger = KeyPair::random();
$now = time();

function paymentTx(KeyPair $owner, int $now): \Soneso\StellarSDK\Transaction {
    return (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
}

$lowOwner = KeyPair::random();
$openTx = paymentTx($owner, $now);
$lowTx = paymentTx($lowOwner, $now);
$signedTx = paymentTx($owner, $now);
$signedTx->sign($b, Network::testnet());

function jobRow(string $id, string $token, KeyPair $owner, \Soneso\StellarSDK\Transaction $tx, int $now, string $status = 'pending_signatures'): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return [
        'id' => $id, 'accessToken' => $token, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
        'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => $status, 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
        'requiredWeight' => 2, 'collectedSigners' => [], 'collectedWeight' => 0,
    ];
}

$apiDir = sys_get_temp_dir() . '/skm-decline-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [
    jobRow('offen', 'tok-offen', $owner, $openTx, $now),
    jobRow('signiert', 'tok-signiert', $owner, $signedTx, $now),
    // Gespeichertes requiredWeight 2, der Threshold wurde inzwischen auf 1 gesenkt.
    jobRow('gesenkt', 'tok-gesenkt', $lowOwner, $lowTx, $now),
]]));
$liveSigners = [
    ['publicKey' => $owner->getAccountId(), 'weight' => 1],
    ['publicKey' => $b->getAccountId(), 'weight' => 1],
    ['publicKey' => $c->getAccountId(), 'weight' => 1],
];
// fetchedAt in der Zukunft: bleibt fuer die ganze Testdauer frisch.
file_put_contents($apiDir . '/data/signers_cache.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => $liveSigners, 'thresholds' => ['low' => 1, 'med' => 2, 'high' => 2], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
    'testnet:' . $lowOwner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [
            ['publicKey' => $lowOwner->getAccountId(), 'weight' => 1],
            ['publicKey' => $b->getAccountId(), 'weight' => 1],
            ['publicKey' => $c->getAccountId(), 'weight' => 1],
        ], 'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));

// C2: Challenge-Datei vorbelegen, voll bis zur Obergrenze, 'offen' mit
// CHALLENGE_MAX_PER_JOB offenen Challenges fremder Signer. Neue Challenges muessen alte
// verdraengen, Token und Ablehnen funktionieren trotzdem.
$prefilled = [];
for ($i = 0; $i < CHALLENGE_MAX_PER_JOB; $i++) {
    $prefilled['offen:' . KeyPair::random()->getAccountId()] = ['nonce' => base64_encode(random_bytes(32)), 'expiresAt' => $now + 3600];
}
for ($i = count($prefilled); $i < CHALLENGE_MAX_TOTAL; $i++) {
    $prefilled["fremd-{$i}:GFREMD"] = ['nonce' => base64_encode(random_bytes(32)), 'expiresAt' => $now + 3600];
}
file_put_contents($apiDir . '/data/challenges.json', json_encode($prefilled));

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

    $res = request('POST', BASE_URL . '/offen/decline', [], ['signer' => $b->getAccountId(), 'signature' => 'AAAA']);
    check('Ablehnen ohne Challenge -> 400 challenge_missing_or_expired (wie Node)', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    $res = decline('offen', $b, KeyPair::random());
    check('Ablehnen mit fremder Signatur -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $res = request('POST', BASE_URL . '/offen/decline', [], ['signer' => 42, 'signature' => ['x']]);
    check('Ablehnen mit Eingaben ohne String -> 400 statt 500', $res['status'] === 400);
    $res = decline('offen', $stranger);
    check('Ablehnen durch Nicht-Signer -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');

    $nonce = challengeFor('offen', $b);
    $res = request('POST', BASE_URL . '/offen/decline', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign($nonce))]);
    check('Rohsignatur der Nonce gilt nicht als Ablehnung -> 403', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $nonce = challengeFor('offen', $b);
    $res = request('POST', BASE_URL . '/offen/decline', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:token:' . $nonce))]);
    check('Token-Signatur gilt nicht als Ablehnung -> 403', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');

    // Token-Endpunkt: nur "skm:token:" plus Nonce ist gueltig.
    $tokenWith = function (string $prefix) use ($b): array {
        $nonce = challengeFor('offen', $b);
        return request('POST', BASE_URL . '/offen/token', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign($prefix . $nonce))]);
    };
    $res = $tokenWith('skm:token:');
    check('Token mit skm:token: -> 200 und Token (nach Verdraengung alter Challenges)', $res['status'] === 200 && ($res['body']['accessToken'] ?? '') === 'tok-offen');
    $stored = json_decode((string)file_get_contents($apiDir . '/data/challenges.json'), true) ?: [];
    $ofOpen = array_filter(array_keys($stored), fn($k) => str_starts_with((string)$k, 'offen:'));
    check('Challenge-Datei bleibt bei hoechstens CHALLENGE_MAX_TOTAL Eintraegen', count($stored) <= CHALLENGE_MAX_TOTAL);
    check('Job offen hat hoechstens CHALLENGE_MAX_PER_JOB offene Challenges', count($ofOpen) <= CHALLENGE_MAX_PER_JOB);
    check('Vorbelegte Challenges von offen wurden verdraengt', count(array_intersect_key($stored, $prefilled)) < count($prefilled));
    $res = $tokenWith('');
    check('Token mit Rohsignatur der Nonce -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $res = $tokenWith('skm:decline:');
    check('Token mit decline-Signatur -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $nonce = challengeFor('offen', $b);
    $sig = base64_encode($b->sign('skm:decline:' . $nonce));
    $res = request('POST', BASE_URL . '/signiert/decline', [], ['signer' => $b->getAccountId(), 'signature' => $sig]);
    check('Challenge eines anderen Jobs gilt nicht -> 400', $res['status'] === 400);

    $res = decline('offen', $b);
    check('Ablehnen durch B -> 200, Job bleibt offen (A und C erreichen 2)', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'pending_signatures');
    check('Ablehnung von B vermerkt', ($res['body']['declinedSigners'][0]['publicKey'] ?? '') === $b->getAccountId());
    $list = request('GET', BASE_URL . '?network=testnet&accountId=' . $owner->getAccountId());
    $row = array_values(array_filter($list['body'], fn($j) => ($j['id'] ?? '') === 'offen'))[0] ?? [];
    check('Liste zeigt die Ablehnung', ($row['declinedSigners'][0]['publicKey'] ?? '') === $b->getAccountId());

    $res = decline('offen', $c);
    check('Ablehnen durch C -> rejected (nur noch A mit Gewicht 1)', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'rejected');
    $res = decline('offen', $owner);
    check('Abgelehnter Job nimmt keine weitere Ablehnung an -> 409 rejected', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'rejected');
    $openTx->sign($owner, Network::testnet());
    $res = request('POST', BASE_URL . '/offen/merge-signed-xdr', ['x-job-token: tok-offen'], ['signedXdr' => $openTx->toEnvelopeXdrBase64()]);
    check('Abgelehnter Job nimmt keine Signatur mehr an -> 409', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'rejected');

    $res = decline('offen', $c);
    check('Challenge ist einmalig: abgelehnter Job meldet 409 statt erneuter Wirkung', $res['status'] === 409);

    decline('gesenkt', $b);
    $res = decline('gesenkt', $c);
    check('Gesenkter Threshold: Gewicht neu berechnet, Job bleibt offen', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'pending_signatures');

    $res = decline('signiert', $b);
    check('Wer schon signiert hat, kann nicht ablehnen -> 409 already_signed', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'already_signed');

    // Loeschen einzelner Jobs (C1, signierte Challenge mit Zweck delete): test/multisigDelete.test.php.

    // C2: Rate-Limit am Ende, danach ist das Budget verbraucht. Die Tests davor haben
    // schon Challenges geholt, spaetestens die 21. Anfrage der Minute ergibt 429.
    $res = null;
    for ($i = 0; $i <= MULTISIG_CHALLENGE_RATE_LIMIT_MAX; $i++) {
        $res = request('POST', BASE_URL . '/offen/challenge', [], ['signer' => $b->getAccountId()]);
        if ($res['status'] === 429) break;
    }
    check('Challenge: spaetestens die 21. Anfrage je Minute -> 429 too_many_requests mit retryAfter',
        $res['status'] === 429 && ($res['body']['error'] ?? '') === 'too_many_requests' && (int)($res['body']['retryAfter'] ?? 0) >= 1);
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
