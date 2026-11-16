<?php
// ADR 0013 (PHP), Zustaende eines Jobs mit fremder op.source (Review FS-3, FS-7.3 bis FS-7.5).
// Ein solcher Job wird nie automatisch gesendet und wartet als ready_to_submit bis zum Ablauf oder Widerruf.
// - FS-3: Faellt das Gewicht nach dem Speichern (Signer entfernt), berechnet ein Merge ohne neue Signatur
//   den Status neu (pending_signatures).
// - FS-7.3: Altjob ohne gespeichertes Feld foreignOpSources: Detail und Liste liefern es aus dem XDR,
//   ein Merge bis zum Gewicht sendet nicht.
// - FS-7.4: wartender Job laeuft ab (expired, Merge 409) oder seine Sequence ist verbraucht (obsolete_seq);
//   Loeschen erst im Endzustand.
// - FS-7.5: Ablehnen durch einen nicht gesammelten Signer laesst ready_to_submit stehen.
// Altjob und FS-3-Job liegen vor dem Start in der Jobdatei, Kontodaten im vorbelegten signers_cache_v2.json
// (Stand nach der Aenderung, wie in Node). Horizon ist ein lokaler Stub, der jede Anfrage protokolliert.
// Pendant: test/multisigForeignOpSourceStates.test.js.
//
// Run with: php test/multisigForeignOpSourceStates.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\MuxedAccount;
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

const TEST_PORT = 3976;
const STUB_PORT = 3977;
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
// Challenge holen, mit Zweck-Praefix signieren und an /decline bzw. /delete schicken.
function withChallenge(string $jobId, KeyPair $signer, string $purpose): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $signer->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return request('POST', BASE_URL . "/{$jobId}/{$purpose}", [], [
        'signer' => $signer->getAccountId(),
        'signature' => base64_encode($signer->sign("skm:{$purpose}:" . $nonce)),
        'challenge' => base64_encode($nonce),
    ]);
}

$foreign = KeyPair::random()->getAccountId();
$dropped = KeyPair::random(); $d1 = KeyPair::random(); $d2 = KeyPair::random();   // FS-3
$legacy = KeyPair::random(); $l1 = KeyPair::random(); $l2 = KeyPair::random();    // FS-7.3
$expiring = KeyPair::random();                                                    // FS-7.4 Ablauf
$revoked = KeyPair::random();                                                     // FS-7.4 Widerruf
$decl = KeyPair::random(); $e1 = KeyPair::random(); $e2 = KeyPair::random(); $e3 = KeyPair::random(); // FS-7.5

$payment = function (KeyPair $source, array $signers, int $timeout = 3600) use ($foreign): AbstractTransaction {
    $now = time();
    $op = (new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))
        ->setMuxedSourceAccount(MuxedAccount::fromAccountId($foreign));
    $tx = (new TransactionBuilder(new Account($source->getAccountId(), new BigInteger(100))))
        ->addOperation($op->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + $timeout)))
        ->build();
    foreach ($signers as $kp) $tx->sign($kp, Network::testnet());
    return $tx;
};
$sig = fn(KeyPair $kp, int $w = 1) => ['publicKey' => $kp->getAccountId(), 'weight' => $w, 'type' => 'ed25519_public_key'];
$seeded = fn(string $id, KeyPair $source, AbstractTransaction $tx, array $extra) => array_merge([
    'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $source->getAccountId(),
    'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $tx->toEnvelopeXdrBase64(),
    'txXdrCurrent' => $tx->toEnvelopeXdrBase64(), 'createdAt' => gmdate('c'), 'maxTimeUnix' => time() + 3600,
], $extra);
$cacheEntry = fn(array $signers, int $threshold, string $sequence = '100') => [
    'data' => ['ok' => true, 'signers' => $signers, 'thresholds' => ['low' => $threshold, 'med' => $threshold, 'high' => $threshold], 'sequence' => $sequence],
    'fetchedAt' => time() + 3600,
];

// FS-3: gespeichert mit d1 und d2 als ready_to_submit; live ist d2 kein Signer mehr.
$txDropped = $payment($dropped, [$d1, $d2]);
// FS-7.3: Altjob von vor ADR 0013, ohne Feld foreignOpSources, von l1 signiert.
$txLegacy = $payment($legacy, [$l1]);

$apiDir = sys_get_temp_dir() . '/skm-foreign-states-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-foreign-states-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:" . STUB_PORT . "'", $networks);
check('sanity: Horizon-URL in der Testkopie ersetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);
file_put_contents($sideDir . '/stub.php', '<?php
$path = parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH);
file_put_contents(__DIR__ . "/requests.log", ($_SERVER["REQUEST_METHOD"] ?? "") . " " . $path . "\n", FILE_APPEND);
header("Content-Type: application/json");
if (($_SERVER["REQUEST_METHOD"] ?? "") === "POST" && $path === "/transactions") { echo json_encode(["hash" => str_repeat("b", 64), "ledger" => 7]); return; }
http_response_code(404); echo "{}";');
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => [
    $seeded('dropped', $dropped, $txDropped, [
        'status' => 'ready_to_submit', 'signers' => [$sig($dropped, 0), $sig($d1), $sig($d2)], 'requiredWeight' => 2,
        'collectedSigners' => [$sig($d1), $sig($d2)], 'collectedWeight' => 2, 'foreignOpSources' => [$foreign],
    ]),
    $seeded('legacy', $legacy, $txLegacy, [
        'status' => 'pending_signatures', 'signers' => [$sig($legacy, 0), $sig($l1), $sig($l2)], 'requiredWeight' => 2,
        'collectedSigners' => [$sig($l1)], 'collectedWeight' => 1,
    ]),
]]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $dropped->getAccountId() => $cacheEntry([$sig($dropped, 0), $sig($d1)], 2),
    'testnet:' . $legacy->getAccountId() => $cacheEntry([$sig($legacy, 0), $sig($l1), $sig($l2)], 2),
    'testnet:' . $expiring->getAccountId() => $cacheEntry([$sig($expiring)], 1),
    // Sequence 1000 >= Sequence der Job-Transaktion (101): wie nach einem Widerruf per bumpSequence.
    'testnet:' . $revoked->getAccountId() => $cacheEntry([$sig($revoked)], 1, '1000'),
    'testnet:' . $decl->getAccountId() => $cacheEntry([$sig($decl, 0), $sig($e1), $sig($e2), $sig($e3)], 2),
]));
$env = array_merge(getenv(), [
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
    'MULTISIG_JOB_LIST_RATE_LIMIT_PATH' => $sideDir . '/job_list_rl.json',
]);
$null = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$stub = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . STUB_PORT, $sideDir . '/stub.php'], $null, $p1, $sideDir);
$server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'], $null, $p2, $apiDir, $env);
$posts = function () use ($sideDir): int {
    $log = $sideDir . '/requests.log';
    $lines = file_exists($log) ? explode("\n", (string)file_get_contents($log)) : [];
    return count(array_filter($lines, fn($l) => $l === 'POST /transactions'));
};
$stored = function (string $id) use ($jobsFile): ?array {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    foreach ($data['items'] ?? [] as $j) if (($j['id'] ?? '') === $id) return $j;
    return null;
};
$create = fn(KeyPair $source, AbstractTransaction $tx) => request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $source->getAccountId(), 'txXdr' => $tx->toEnvelopeXdrBase64()]);
$merge = fn(string $id, string $token, AbstractTransaction $tx) => request('POST', BASE_URL . '/' . $id . '/merge-signed-xdr', ['x-job-token: ' . $token], ['signedXdr' => $tx->toEnvelopeXdrBase64()]);
$detail = fn(string $id, string $token) => request('GET', BASE_URL . '/' . $id, ['x-job-token: ' . $token])['body'];

try {
    check('sanity: Horizon-Stub und PHP-Server laufen', waitFor(STUB_PORT) && waitFor(TEST_PORT));

    // FS-3
    $before = $posts();
    $res = $merge('dropped', 'tok-dropped', $txDropped);
    check('FS-3: Gewicht gefallen, Merge ohne neue Signatur: 200 pending_signatures, nur d1 zaehlt',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'pending_signatures' && ($res['body']['collectedWeight'] ?? 0) === 1);
    check('FS-3: gespeichert pending_signatures mit foreignOpSources, nichts gesendet',
        ($stored('dropped')['status'] ?? '') === 'pending_signatures' && ($stored('dropped')['foreignOpSources'] ?? null) === [$foreign]
        && $posts() === $before);

    // FS-7.3
    check('FS-7.3 sanity: Feld foreignOpSources fehlt in der Jobdatei', !array_key_exists('foreignOpSources', $stored('legacy') ?? []));
    $d = $detail('legacy', 'tok-legacy');
    check('FS-7.3: Detail liefert foreignOpSources aus dem XDR',
        ($d['status'] ?? '') === 'pending_signatures' && ($d['foreignOpSources'] ?? null) === [$foreign]);
    $list = request('GET', BASE_URL . '?network=testnet&accountId=' . $legacy->getAccountId());
    $row = array_values(array_filter($list['body'], fn($j) => ($j['id'] ?? '') === 'legacy'))[0] ?? [];
    check('FS-7.3: Liste liefert foreignOpSources aus dem XDR', ($row['foreignOpSources'] ?? null) === [$foreign]);
    $before = $posts();
    $txLegacy->sign($l2, Network::testnet());
    $res = $merge('legacy', 'tok-legacy', $txLegacy);
    check('FS-7.3: Merge bis zum Gewicht: 200 ready_to_submit',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'ready_to_submit' && ($res['body']['collectedWeight'] ?? 0) === 2);
    check('FS-7.3: Feld beim Merge nachgetragen, gespeichert ready_to_submit, nichts gesendet',
        ($stored('legacy')['foreignOpSources'] ?? null) === [$foreign] && ($stored('legacy')['status'] ?? '') === 'ready_to_submit'
        && $posts() === $before);

    // FS-7.4 Ablauf
    $before = $posts();
    $tx = $payment($expiring, [$expiring], 3);
    $created = $create($expiring, $tx);
    check('FS-7.4: wartender Job mit kurzem Zeitfenster ready_to_submit', ($created['body']['status'] ?? '') === 'ready_to_submit');
    $id = (string)($created['body']['id'] ?? '');
    $token = (string)($created['body']['accessToken'] ?? '');
    $early = withChallenge($id, $expiring, 'delete');
    check('FS-7.4: Loeschen vor dem Ablauf 409 not_final, Job bleibt',
        $early['status'] === 409 && ($early['body']['error'] ?? '') === 'not_final' && $stored($id) !== null);
    $status = '';
    for ($i = 0; $i < 80 && $status !== 'expired'; $i++) {
        usleep(100000);
        $status = (string)($detail($id, $token)['status'] ?? '');
    }
    check('FS-7.4: nach maxTime liefert das Lesen expired', $status === 'expired');
    $res = $merge($id, $token, $tx);
    check('FS-7.4: Merge nach dem Ablauf 409 expired, gespeichert expired',
        $res['status'] === 409 && ($res['body']['error'] ?? '') === 'expired' && ($stored($id)['status'] ?? '') === 'expired');
    $late = withChallenge($id, $expiring, 'delete');
    check('FS-7.4: Loeschen nach dem Ablauf 200, Job entfernt', $late['status'] === 200 && $stored($id) === null);
    check('FS-7.4: abgelaufener Job nie gesendet', $posts() === $before);

    // FS-7.4 Widerruf
    $before = $posts();
    $tx = $payment($revoked, [$revoked]);
    $created = $create($revoked, $tx);
    $id = (string)($created['body']['id'] ?? '');
    $token = (string)($created['body']['accessToken'] ?? '');
    check('FS-7.4: verbrauchte Sequence: Lesen liefert obsolete_seq', ($detail($id, $token)['status'] ?? '') === 'obsolete_seq');
    $res = $merge($id, $token, $tx);
    check('FS-7.4: Merge mit verbrauchter Sequence 409 obsolete_seq', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'obsolete_seq');
    $del = withChallenge($id, $revoked, 'delete');
    check('FS-7.4: Loeschen nach dem Widerruf 200, Job entfernt, nie gesendet', $del['status'] === 200 && $stored($id) === null && $posts() === $before);

    // FS-7.5
    $before = $posts();
    $created = $create($decl, $payment($decl, [$e1, $e2]));
    check('FS-7.5: wartender Job 2 von 3 ready_to_submit', ($created['body']['status'] ?? '') === 'ready_to_submit');
    $id = (string)($created['body']['id'] ?? '');
    $token = (string)($created['body']['accessToken'] ?? '');
    $res = withChallenge($id, $e3, 'decline');
    check('FS-7.5: Ablehnen durch nicht gesammelten Signer: 200, Status bleibt ready_to_submit',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'ready_to_submit'
        && array_column($res['body']['declinedSigners'] ?? [], 'publicKey') === [$e3->getAccountId()]);
    check('FS-7.5: gespeichert und gelesen ready_to_submit, nichts gesendet',
        ($stored($id)['status'] ?? '') === 'ready_to_submit' && ($detail($id, $token)['status'] ?? '') === 'ready_to_submit' && $posts() === $before);
} finally {
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
