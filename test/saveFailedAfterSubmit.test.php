<?php
// B3-1 / R-3 (PHP): Write-ahead beim Senden durch das Backend (Anlegen und Merge). Vor dem POST wird
// der Job als submit_unclear gespeichert, erst danach gesendet und das Ergebnis geschrieben.
// - Scheitert das Speichern vor dem POST, wird nicht gesendet: 500 save_failed bzw. merge_failed.
// - Scheitert das Speichern nach dem POST: 500 save_failed_after_submit, gespeichert bleibt
//   submit_unclear, nie ein erneutes Senden.
// Horizon ist ein lokaler Stub (Antwort auf POST /transactions, zaehlt in submit.log), die URL steht
// nur in der Testkopie von api/stellarNetworks.php. Das Konto (Signer-Cache) hat Schwelle 1. Der
// Speicherfehler entsteht durch einen schreibgeschuetzten Datenordner, vor dem Request oder (Datei
// arm) erst beim Senden durch den Stub. Pendant: test/saveFailedAfterSubmit.test.js.
//
// Run with: php test/saveFailedAfterSubmit.test.php

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

const TEST_PORT = 3941;
const STUB_PORT = 3942;
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

$owner = KeyPair::random();
$now = time();
function buildTx(KeyPair $owner, int $now, bool $sign): \Soneso\StellarSDK\Transaction {
    $tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
    if ($sign) $tx->sign($owner, Network::testnet());
    return $tx;
}
$mergeJobs = [];
foreach (['merge-before', 'merge-after'] as $id) {
    $t = buildTx($owner, $now, false);
    $unsigned = $t->toEnvelopeXdrBase64();
    $hash = bin2hex($t->hash(Network::testnet()));
    $t->sign($owner, Network::testnet());
    $mergeJobs[$id] = ['unsigned' => $unsigned, 'signed' => $t->toEnvelopeXdrBase64(), 'hash' => $hash];
}
$createSigned = fn() => buildTx($owner, $now, true)->toEnvelopeXdrBase64();
$createUnsigned = fn() => buildTx($owner, $now, false)->toEnvelopeXdrBase64();

$apiDir = sys_get_temp_dir() . '/skm-aftersubmit-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-aftersubmit-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
// Horizon-Stub: nur in der Testkopie.
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:" . STUB_PORT . "'", $networks);
check('sanity: Horizon-URL in der Testkopie ersetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);
file_put_contents($sideDir . '/stub.php', "<?php file_put_contents(__DIR__ . '/submit.log', \"submit\\n\", FILE_APPEND);\n"
    . "if (file_exists(__DIR__ . '/arm')) chmod(" . var_export($apiDir . '/data', true) . ", 0555);\n"
    . "header('Content-Type: application/json'); echo json_encode(['hash' => 'mockhash', 'ledger' => 1]);");

file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => array_map(fn($id) => [
    'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
    'txHash' => $mergeJobs[$id]['hash'], 'txXdrOriginal' => $mergeJobs[$id]['unsigned'], 'txXdrCurrent' => $mergeJobs[$id]['unsigned'],
    'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
    'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
], array_keys($mergeJobs))]));
$submits = fn() => file_exists($sideDir . '/submit.log') ? count(array_filter(explode("\n", (string)file_get_contents($sideDir . '/submit.log')))) : 0;
$storedItems = function () use ($apiDir): array {
    clearstatcache();
    return json_decode((string)file_get_contents($apiDir . '/data/multisig_jobs.json'), true)['items'] ?? [];
};
$storedJob = function (string $id) use ($storedItems): ?array {
    foreach ($storedItems() as $j) if (($j['id'] ?? '') === $id) return $j;
    return null;
};
$create = fn(string $xdr) => request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => $xdr]);
$merge = fn(string $id) => request('POST', BASE_URL . '/' . $id . '/merge-signed-xdr', ['x-job-token: tok-' . $id], ['signedXdr' => $mergeJobs[$id]['signed']]);
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [['publicKey' => $owner->getAccountId(), 'weight' => 1]],
            'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1], 'sequence' => '100'],
        'fetchedAt' => time() + 3600,
    ],
]));

$env = array_merge(getenv(), [
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
]);
$null = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$stub = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . STUB_PORT, $sideDir . '/stub.php'], $null, $p1, $sideDir);
$server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'], $null, $p2, $apiDir, $env);

try {
    check('sanity: Horizon-Stub und PHP-Server laufen', waitFor(STUB_PORT) && waitFor(TEST_PORT));

    $before = $submits();
    $res = $create($createSigned());
    check('Gegenprobe: bei beschreibbarem Ordner wird beim Anlegen gesendet und gespeichert',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submitted_success' && $submits() === $before + 1
        && (($storedJob($res['body']['id'] ?? '') ?? [])['status'] ?? '') === 'submitted_success');

    chmod($apiDir . '/data', 0555);
    $writable = @file_put_contents($apiDir . '/data/probe', 'x') !== false;
    chmod($apiDir . '/data', 0775);
    if ($writable) {
        @unlink($apiDir . '/data/probe');
        echo "- Speicherfehler nicht simulierbar (Prozess darf trotz 0555 schreiben), Faelle uebersprungen\n";
    } else {
        // Speicherfehler vor dem Senden: nichts gesendet.
        chmod($apiDir . '/data', 0555);
        $before = $submits();
        $res = $create($createSigned());
        check('R-3 Anlegen: Speicherfehler vor dem Senden ergibt 500 multisig.jobs.save_failed (wie Node)',
            $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.save_failed');
        check('R-3 Anlegen: Speicherfehler vor dem Senden, kein POST', $submits() === $before);
        $res = $merge('merge-before');
        check('R-3 Merge: Speicherfehler vor dem Senden ergibt 500 multisig.jobs.merge_failed (wie Node)',
            $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.merge_failed');
        check('R-3 Merge: Speicherfehler vor dem Senden, kein POST', $submits() === $before);
        $res = $create($createUnsigned());
        check('Anlegen ohne Senden: Speicherfehler bleibt multisig.jobs.save_failed', $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.save_failed');
        chmod($apiDir . '/data', 0775);
        $mb = $storedJob('merge-before');
        check('R-3 Merge: Speicherfehler vor dem Senden, Job unveraendert',
            ($mb['status'] ?? '') === 'pending_signatures' && ($mb['txXdrCurrent'] ?? '') === $mergeJobs['merge-before']['unsigned']);

        // Speicherfehler nach dem Senden (Stub schuetzt den Ordner beim POST): Write-ahead bleibt.
        touch($sideDir . '/arm');
        $before = $submits();
        $countBefore = count($storedItems());
        $res = $create($createSigned());
        chmod($apiDir . '/data', 0775);
        check('R-3 Anlegen: Speicherfehler nach dem Senden ergibt 500 multisig.jobs.save_failed_after_submit (wie Node)',
            $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.save_failed_after_submit');
        $items = $storedItems();
        check('R-3 Anlegen: einmal gesendet, Job vor dem Senden gespeichert, Status submit_unclear',
            $submits() === $before + 1 && count($items) === $countBefore + 1 && ($items[0]['status'] ?? '') === 'submit_unclear'
            && !empty($items[0]['submittedAt']));
        $res = $merge('merge-after');
        chmod($apiDir . '/data', 0775);
        unlink($sideDir . '/arm');
        check('R-3 Merge: Speicherfehler nach dem Senden ergibt 500 multisig.jobs.save_failed_after_submit (wie Node)',
            $res['status'] === 500 && ($res['body']['error'] ?? '') === 'multisig.jobs.save_failed_after_submit');
        $ma = $storedJob('merge-after');
        check('R-3 Merge: gespeichert submit_unclear mit der neuen Signatur',
            ($ma['status'] ?? '') === 'submit_unclear' && ($ma['txXdrCurrent'] ?? '') === $mergeJobs['merge-after']['signed']);
        $sent = $submits();
        $res = $merge('merge-after');
        check('R-3 Merge: erneuter Merge 409 submit_unclear ohne weiteren POST',
            $res['status'] === 409 && ($res['body']['error'] ?? '') === 'submit_unclear' && $submits() === $sent);
    }
} finally {
    @chmod($apiDir . '/data', 0775);
    proc_terminate($server);
    proc_close($server);
    proc_terminate($stub);
    proc_close($stub);
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
