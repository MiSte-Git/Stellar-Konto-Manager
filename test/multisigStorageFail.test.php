<?php
// Speicherfehler (PHP): Schlaegt das Schreiben der Jobdatei fehl, meldet kein Weg Erfolg.
// Anlegen, Merge und Loeschen antworten 500 und aendern nichts. Beim Loeschen heisst der Code
// multisig.jobs.delete_failed wie in Node (vorher server_error). Der Fehler entsteht, indem
// der Datenordner nach dem Start schreibgeschuetzt wird; Challenge-Datei und Rate-Limits
// liegen per Umgebungsvariable in einem eigenen, beschreibbaren Ordner.
// Echter HTTP-Test gegen api/multisig.php. Pendant: test/multisigStorageFail.test.js.
//
// Run with: php test/multisigStorageFail.test.php

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

const TEST_PORT = 3933;
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
$now = time();

function buildTx(KeyPair $owner, int $now): \Soneso\StellarSDK\Transaction {
    return (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
}
$tx = buildTx($owner, $now);
$unsignedXdr = $tx->toEnvelopeXdrBase64();
$hash = bin2hex($tx->hash(Network::testnet()));
$tx->sign($owner, Network::testnet());
$signedXdr = $tx->toEnvelopeXdrBase64();
$createXdr = buildTx($owner, $now)->toEnvelopeXdrBase64();

function jobRow(string $id, string $status, string $accountId, string $xdr, string $hash, int $now): array {
    return [
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $accountId,
        'txHash' => $hash, 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => $status, 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
        'requiredWeight' => 2, 'collectedSigners' => [], 'collectedWeight' => 0,
    ];
}

$apiDir = sys_get_temp_dir() . '/skm-storefail-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-storefail-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => [
    jobRow('merge-job', 'pending_signatures', $owner->getAccountId(), $unsignedXdr, $hash, $now),
    jobRow('final-job', 'expired', $owner->getAccountId(), $unsignedXdr, $hash, $now),
]]));
file_put_contents($apiDir . '/data/signers_cache.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [
            ['publicKey' => $owner->getAccountId(), 'weight' => 1], ['publicKey' => $b->getAccountId(), 'weight' => 1],
        ], 'thresholds' => ['low' => 2, 'med' => 2, 'high' => 2], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));

$env = array_merge(getenv(), [
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
]);
$server = proc_open(
    [PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir,
    $env
);
$storedIds = function () use ($jobsFile): array {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    return array_map(fn($j) => $j['id'] ?? '', $data['items'] ?? []);
};
$storedWeight = function () use ($jobsFile): int {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    foreach ($data['items'] ?? [] as $j) if (($j['id'] ?? '') === 'merge-job') return (int)($j['collectedWeight'] ?? -1);
    return -1;
};

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    // Challenge fuer das Loeschen holen, solange der Datenordner noch beschreibbar ist.
    $ch = request('POST', BASE_URL . '/final-job/challenge', [], ['signer' => $b->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    $deleteBody = ['signer' => $b->getAccountId(), 'signature' => base64_encode($b->sign('skm:delete:' . $nonce))];

    chmod($apiDir . '/data', 0555);
    clearstatcache();
    $writable = @file_put_contents($apiDir . '/data/probe', 'x') !== false;
    if ($writable) {
        @unlink($apiDir . '/data/probe');
        echo "- Speicherfehler nicht simulierbar (Prozess darf trotz 0555 schreiben), Faelle uebersprungen\n";
    } else {
        check('sanity: Datenordner ist schreibgeschuetzt', true);

        $res = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => $createXdr]);
        check('Anlegen: Speicherfehler ergibt 500 multisig.jobs.save_failed (wie Node) und keinen Erfolg', $res['status'] === 500 && ($res['body']['ok'] ?? null) === false && ($res['body']['error'] ?? '') === 'multisig.jobs.save_failed' && !isset($res['body']['id']));
        check('Anlegen: keine neue Zeile in der Datei', $storedIds() === ['merge-job', 'final-job']);

        $res = request('POST', BASE_URL . '/merge-job/merge-signed-xdr', ['x-job-token: tok-merge-job'], ['signedXdr' => $signedXdr]);
        check('Merge: Speicherfehler ergibt 500 multisig.jobs.merge_failed (wie Node) und keinen Erfolg', $res['status'] === 500 && ($res['body']['ok'] ?? null) === false && ($res['body']['error'] ?? '') === 'multisig.jobs.merge_failed');
        check('Merge: Signatur nicht gespeichert', $storedWeight() === 0);

        $res = request('POST', BASE_URL . '/final-job/delete', [], $deleteBody);
        check('Loeschen: Speicherfehler ergibt 500 multisig.jobs.delete_failed (wie Node)', $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.delete_failed');
        check('Loeschen: Job bleibt in der Datei', in_array('final-job', $storedIds(), true));
    }

    chmod($apiDir . '/data', 0775);
    $res = request('POST', BASE_URL . '/merge-job/merge-signed-xdr', ['x-job-token: tok-merge-job'], ['signedXdr' => $signedXdr]);
    check('Merge nach behobenem Speicherfehler: 200 und Signatur gespeichert', $res['status'] === 200 && $storedWeight() === 1);
} finally {
    @chmod($apiDir . '/data', 0775);
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
