<?php
// ADR 0013 (PHP): Ein Job mit fremder op.source wird nie automatisch gesendet. Das Backend prueft nur
// Gewicht und Signer des Job-Kontos; gesendet haette das Netz mit tx_bad_auth abgelehnt (submitted_failed).
// Anlegen (Single-Sig) und Merge (Gewicht erreicht) speichern ready_to_submit mit foreignOpSources und
// senden nicht; ohne fremde Quelle wird wie bisher gesendet. Liste und Detail liefern das Feld.
// Horizon ist ein lokaler Stub (protokolliert jede Anfrage), Kontodaten aus vorbelegtem
// signers_cache_v2.json. Pendant: test/multisigForeignOpSource.test.js.
//
// Run with: php test/multisigForeignOpSource.test.php

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

const TEST_PORT = 3966;
const STUB_PORT = 3967;
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

$owner = KeyPair::random();   // Single-Sig
$vault = KeyPair::random();   // 2 von 2
$s1 = KeyPair::random();
$s2 = KeyPair::random();
$foreign = KeyPair::random()->getAccountId();
$now = time();
$seq = 100;
$payment = function (string $source, ?string $opSource, array $signers) use (&$seq, $now): AbstractTransaction {
    $seq++;
    $op = new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1');
    if ($opSource !== null) $op->setMuxedSourceAccount(MuxedAccount::fromAccountId($opSource));
    $tx = (new TransactionBuilder(new Account($source, new BigInteger($seq))))
        ->addOperation($op->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
    foreach ($signers as $kp) $tx->sign($kp, Network::testnet());
    return $tx;
};
$create = fn(string $accountId, AbstractTransaction $tx) => request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $accountId, 'txXdr' => $tx->toEnvelopeXdrBase64()]);
$merge = fn(array $job, AbstractTransaction $tx) => request('POST', BASE_URL . '/' . $job['id'] . '/merge-signed-xdr', ['x-job-token: ' . $job['accessToken']], ['signedXdr' => $tx->toEnvelopeXdrBase64()]);

$apiDir = sys_get_temp_dir() . '/skm-foreign-src-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-foreign-src-side-' . bin2hex(random_bytes(4));
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
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => []]));
$cacheEntry = fn(array $signers, int $threshold) => [
    'data' => ['ok' => true, 'signers' => $signers, 'thresholds' => ['low' => $threshold, 'med' => $threshold, 'high' => $threshold], 'sequence' => '100'],
    'fetchedAt' => time() + 3600,
];
$sig = fn(string $pk, int $w) => ['publicKey' => $pk, 'weight' => $w, 'type' => 'ed25519_public_key'];
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => $cacheEntry([$sig($owner->getAccountId(), 1)], 1),
    'testnet:' . $vault->getAccountId() => $cacheEntry([$sig($vault->getAccountId(), 0), $sig($s1->getAccountId(), 1), $sig($s2->getAccountId(), 1)], 2),
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

try {
    check('sanity: Horizon-Stub und PHP-Server laufen', waitFor(STUB_PORT) && waitFor(TEST_PORT));

    $before = $posts();
    $res = $create($owner->getAccountId(), $payment($owner->getAccountId(), $foreign, [$owner]));
    check('Anlegen, Gewicht erreicht, fremde op.source: 200 ready_to_submit',
        $res['status'] === 200 && ($res['body']['status'] ?? '') === 'ready_to_submit');
    check('Anlegen: foreignOpSources am Job', ($res['body']['foreignOpSources'] ?? null) === [$foreign]);
    check('Anlegen: nichts an Horizon gesendet', $posts() === $before);
    $job = $res['body'];
    $detail = request('GET', BASE_URL . '/' . $job['id'], ['x-job-token: ' . $job['accessToken']]);
    check('Detail: ready_to_submit mit foreignOpSources',
        ($detail['body']['status'] ?? '') === 'ready_to_submit' && ($detail['body']['foreignOpSources'] ?? null) === [$foreign]);
    $list = request('GET', BASE_URL . '?network=testnet&accountId=' . $owner->getAccountId());
    $row = array_values(array_filter($list['body'], fn($j) => ($j['id'] ?? '') === $job['id']))[0] ?? [];
    check('Liste liefert foreignOpSources', ($row['foreignOpSources'] ?? null) === [$foreign]);

    $before = $posts();
    $muxedOwner = (new MuxedAccount($owner->getAccountId(), 9))->getAccountId();
    $res = $create($owner->getAccountId(), $payment($owner->getAccountId(), $muxedOwner, [$owner]));
    check('Anlegen, M-Adresse des Job-Kontos als op.source: nicht fremd, gesendet',
        ($res['body']['status'] ?? '') === 'submitted_success' && ($res['body']['foreignOpSources'] ?? null) === [] && $posts() === $before + 1);

    $before = $posts();
    $res = $create($owner->getAccountId(), $payment($owner->getAccountId(), null, [$owner]));
    check('Anlegen ohne fremde op.source: wie bisher gesendet', ($res['body']['status'] ?? '') === 'submitted_success' && $posts() === $before + 1);

    $tx = $payment($vault->getAccountId(), $foreign, [$s1]);
    $created = $create($vault->getAccountId(), $tx);
    check('Merge-Fall: angelegt als pending_signatures mit foreignOpSources',
        ($created['body']['status'] ?? '') === 'pending_signatures' && ($created['body']['foreignOpSources'] ?? null) === [$foreign]);
    $before = $posts();
    $tx->sign($s2, Network::testnet());
    $merged = $merge($created['body'], $tx);
    check('Merge erreicht das Gewicht, fremde op.source: 200 ready_to_submit',
        $merged['status'] === 200 && ($merged['body']['status'] ?? '') === 'ready_to_submit' && ($merged['body']['collectedWeight'] ?? 0) === 2);
    check('Merge: foreignOpSources und nichts gesendet', ($merged['body']['foreignOpSources'] ?? null) === [$foreign] && $posts() === $before);
    $again = $merge($created['body'], $tx);
    check('erneuter Merge ohne neue Signatur bleibt bereit und sendet nicht', ($again['body']['status'] ?? '') === 'ready_to_submit' && $posts() === $before);

    $tx = $payment($vault->getAccountId(), null, [$s1]);
    $created = $create($vault->getAccountId(), $tx);
    $before = $posts();
    $tx->sign($s2, Network::testnet());
    $merged = $merge($created['body'], $tx);
    check('Merge erreicht das Gewicht ohne fremde op.source: wie bisher gesendet',
        ($merged['body']['status'] ?? '') === 'submitted_success' && $posts() === $before + 1);
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
