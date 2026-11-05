<?php
// C1: Loeschen einzelner Multisig-Jobs nur fuer aktuelle Signer per signierter Challenge mit
// Zweck delete (PHP), echter HTTP-Test gegen api/multisig.php wie
// test/multisigDecline.test.php. Die Konto-Signer kommen aus einem vorbelegten
// signers_cache.json (ok => false simuliert einen Horizon-Fehler), damit der volle Ablauf
// ohne Netz laeuft. Das Job-Token reicht zum Loeschen nicht mehr.
// Pendant: test/multisigDelete.test.js.
//
// Run with: php test/multisigDelete.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';
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

const TEST_PORT = 3924;
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

// Budget: /challenge erlaubt 20 Anfragen je Minute und IP (C2), diese Datei braucht 17.
// Neue Faelle nur mit Blick darauf ergaenzen.
// Challenge fuer $signer holen, mit $signWith (Standard: $signer) und $prefix signieren, an $action schicken.
function withChallenge(string $jobId, KeyPair $signer, string $action, string $prefix, ?KeyPair $signWith = null): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $signer->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    $signature = base64_encode(($signWith ?? $signer)->sign($prefix . $nonce));
    return request('POST', BASE_URL . "/{$jobId}/{$action}", [], ['signer' => $signer->getAccountId(), 'signature' => $signature]);
}

$owner = KeyPair::random();
$b = KeyPair::random();
$c = KeyPair::random();
$zero = KeyPair::random();
$stranger = KeyPair::random();
$brokenAccount = KeyPair::random();
$now = time();

$tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
    ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
    ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
    ->build();

function jobRow(string $id, string $status, string $accountId, \Soneso\StellarSDK\Transaction $tx, int $now): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return [
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $accountId,
        'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => $status, 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
        'requiredWeight' => 2, 'collectedSigners' => [], 'collectedWeight' => 0,
    ];
}

$apiDir = sys_get_temp_dir() . '/skm-delete-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => [
    jobRow('offen', 'pending_signatures', $owner->getAccountId(), $tx, $now),
    jobRow('abgelaufen', 'expired', $owner->getAccountId(), $tx, $now),
    jobRow('abgelehnt', 'rejected', $owner->getAccountId(), $tx, $now),
    jobRow('fremd', 'expired', $brokenAccount->getAccountId(), $tx, $now),
]]));

$cacheFile = $apiDir . '/data/signers_cache.json';
// fetchedAt in der Zukunft: bleibt fuer die ganze Testdauer frisch, kein Horizon-Aufruf.
function writeSignersCache(string $file, KeyPair $owner, array $signers, KeyPair $brokenAccount): void {
    file_put_contents($file, json_encode([
        'testnet:' . $owner->getAccountId() => [
            'data' => ['ok' => true, 'signers' => $signers, 'thresholds' => ['low' => 1, 'med' => 2, 'high' => 2], 'sequence' => '100'],
            'fetchedAt' => time() + 3600,
        ],
        // Horizon-Fehler: fetchAccountSigners() liefert ok => false und keine Signer.
        'testnet:' . $brokenAccount->getAccountId() => [
            'data' => ['ok' => false, 'signers' => [], 'thresholds' => ['low' => 0, 'med' => 0, 'high' => 0], 'sequence' => null],
            'fetchedAt' => time() + 3600,
        ],
    ]));
}
writeSignersCache($cacheFile, $owner, [
    ['publicKey' => $owner->getAccountId(), 'weight' => 1],
    ['publicKey' => $b->getAccountId(), 'weight' => 1],
    ['publicKey' => $c->getAccountId(), 'weight' => 1],
    ['publicKey' => $zero->getAccountId(), 'weight' => 0],
], $brokenAccount);

// Abgelaufene Challenge fuer abgelaufen/b vorbelegen, die Nonce ist bekannt.
$expiredNonce = random_bytes(32);
file_put_contents($apiDir . '/data/challenges.json', json_encode([
    challengeKey('abgelaufen', $b->getAccountId()) => ['nonce' => base64_encode($expiredNonce), 'expiresAt' => $now - 5],
]));

$storedIds = function () use ($jobsFile): array {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    $items = $data['items'] ?? $data;
    return array_map(fn($j) => $j['id'] ?? '', is_array($items) ? $items : []);
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

    $res = withChallenge('abgelaufen', $b, 'token', 'skm:token:');
    check('Sanity: token-Signatur eines aktiven Signers bekommt das Token (Signer-Cache greift)', $res['status'] === 200 && ($res['body']['accessToken'] ?? '') === 'tok-abgelaufen');

    // Alter Endpunkt und Job-Token
    $res = request('DELETE', BASE_URL . '/abgelaufen', ['x-job-token: tok-abgelaufen']);
    check('Alter Endpunkt DELETE /jobs/:id existiert nicht mehr -> 404', $res['status'] === 404);
    check('Gueltiges Job-Token allein loescht nichts', in_array('abgelaufen', $storedIds(), true));
    $res = request('POST', BASE_URL . '/abgelaufen/delete', ['x-job-token: tok-abgelaufen'], []);
    check('Neuer Endpunkt: Token statt Signatur -> 400, Job bleibt', $res['status'] === 400 && in_array('abgelaufen', $storedIds(), true));

    // Eingaben
    $res = request('POST', BASE_URL . '/gibtsnicht/delete', [], ['signer' => $b->getAccountId(), 'signature' => 'AAAA']);
    check('Unbekannter Job -> 404 not_found', $res['status'] === 404 && ($res['body']['error'] ?? '') === 'not_found');
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => 'kein-key', 'signature' => 'AAAA']);
    check('Ungueltiger Signer -> 400 invalid_signer', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_signer');
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => '']);
    check('Leere Signatur -> 400 missing_signature', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'missing_signature');
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => 42, 'signature' => ['x']]);
    check('Eingaben ohne String -> 400 statt 500', $res['status'] === 400);

    // Challenge fehlt, abgelaufen, fremder Job, einmalig
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $c->getAccountId(), 'signature' => 'AAAA']);
    check('Ohne Challenge -> 400 challenge_missing_or_expired', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:delete:' . $expiredNonce))]);
    check('Abgelaufene Challenge mit gueltiger delete-Signatur -> 400 challenge_missing_or_expired', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    $ch = request('POST', BASE_URL . '/offen/challenge', [], ['signer' => $b->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:delete:' . $nonce))]);
    check('Challenge eines anderen Jobs -> 400', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    $ch = request('POST', BASE_URL . '/abgelaufen/challenge', [], ['signer' => $b->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:token:' . $nonce))]);
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:delete:' . $nonce))]);
    check('Challenge ist einmalig, auch nach falscher Signatur -> 400', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'challenge_missing_or_expired');
    check('Job nach den Fehlversuchen noch da', in_array('abgelaufen', $storedIds(), true));

    // Zweckbindung
    foreach (['skm:token:' => 'token', 'skm:decline:' => 'decline', '' => 'roh'] as $prefix => $label) {
        $res = withChallenge('abgelaufen', $b, 'delete', $prefix);
        check("Loeschen mit {$label}-Signatur -> 403 invalid_signature", $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    }
    $res = withChallenge('abgelaufen', $b, 'delete', 'skm:delete:', KeyPair::random());
    check('Loeschen mit fremdem Key -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $res = withChallenge('abgelaufen', $b, 'token', 'skm:delete:');
    check('delete-Signatur gilt nicht fuer das Token -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');
    $res = withChallenge('offen', $b, 'decline', 'skm:delete:');
    check('delete-Signatur gilt nicht fuer das Ablehnen -> 403 invalid_signature', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'invalid_signature');

    // Signer live
    $res = withChallenge('abgelaufen', $stranger, 'delete', 'skm:delete:');
    check('Nicht-Signer -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    $res = withChallenge('abgelaufen', $zero, 'delete', 'skm:delete:');
    check('Signer mit Gewicht 0 -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    $res = withChallenge('fremd', $b, 'delete', 'skm:delete:');
    check('Horizon-Fehler beim Job-Konto -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    check('Jobs nach 403 noch da', in_array('abgelaufen', $storedIds(), true) && in_array('fremd', $storedIds(), true));

    // Endzustand
    $res = withChallenge('offen', $b, 'delete', 'skm:delete:');
    check('Offener Job -> 409 not_final mit status', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'not_final' && ($res['body']['status'] ?? '') === 'pending_signatures');
    check('Offener Job bleibt', in_array('offen', $storedIds(), true));

    $res = withChallenge('abgelaufen', $b, 'delete', 'skm:delete:');
    check('Gueltige delete-Signatur eines aktiven Signers loescht den Job im Endzustand -> 200', $res['status'] === 200 && ($res['body']['ok'] ?? false) === true);
    check('Job ist aus der Datei entfernt', !in_array('abgelaufen', $storedIds(), true));
    $res = request('POST', BASE_URL . '/abgelaufen/delete', [], ['signer' => $b->getAccountId(), 'signature' => 'AAAA']);
    check('Geloeschter Job -> 404', $res['status'] === 404);

    // Signer entfernt: b mit Gewicht 0, c nicht mehr in der Liste. b hatte oben noch ein Token.
    writeSignersCache($cacheFile, $owner, [
        ['publicKey' => $owner->getAccountId(), 'weight' => 1],
        ['publicKey' => $b->getAccountId(), 'weight' => 0],
    ], $brokenAccount);
    $res = withChallenge('abgelehnt', $b, 'delete', 'skm:delete:');
    check('Entfernter Signer (Gewicht 0) -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    $res = withChallenge('abgelehnt', $c, 'delete', 'skm:delete:');
    check('Entfernter Signer (nicht mehr in der Liste) -> 403 forbidden', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    check('Job bleibt nach Versuch entfernter Signer', in_array('abgelehnt', $storedIds(), true));
    $res = withChallenge('abgelehnt', $owner, 'delete', 'skm:delete:');
    check('Verbliebener Signer loescht weiter -> 200', $res['status'] === 200 && !in_array('abgelehnt', $storedIds(), true));
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
