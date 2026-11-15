<?php
// F-3 (PHP): submittedResult enthaelt nur Fehlertext und result_codes (Ablehnung) bzw. Hash und
// Ledger (Erfolg), nie envelope_xdr oder result_xdr aus der Horizon-Antwort. Altjobs, die noch die
// ganze Antwort gespeichert haben, werden beim Lesen (Liste, Detail) bereinigt. Horizon ist ein
// lokaler Stub (POST /transactions antwortet 400 mit extras), die URL steht nur in der Testkopie von
// api/stellarNetworks.php. Pendant: test/submitResultLeak.test.js.
//
// Run with: php test/submitResultLeak.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';
require __DIR__ . '/../api/submitResult.php';

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

const TEST_PORT = 3947;
const STUB_PORT = 3948;
const BASE_URL = 'http://127.0.0.1:' . TEST_PORT . '/api/multisig/jobs';
const LEAKS = ['envelope_xdr', 'result_xdr', 'envelopeXdr', 'resultXdr', 'MOCK_ENVELOPE_XDR', 'MOCK_RESULT_XDR', 'OLD_ENVELOPE', 'OLD_RESULT'];

function noLeak($value): bool {
    $text = json_encode($value);
    foreach (LEAKS as $needle) if (strpos($text, $needle) !== false) return false;
    return true;
}

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

// --- Helfer direkt ---
$e = new class('Transaction Failed') extends \Exception {
    public function getExtras(): array {
        return ['envelope_xdr' => 'OLD_ENVELOPE', 'result_xdr' => 'OLD_RESULT', 'result_codes' => ['transaction' => 'tx_insufficient_fee']];
    }
};
check('Helfer: Ablehnung behaelt nur Fehlertext und result_codes',
    json_encode(skm_submit_error_result($e)) === json_encode(['error' => 'Transaction Failed', 'detail' => ['message' => 'Transaction Failed', 'extras' => ['result_codes' => ['transaction' => 'tx_insufficient_fee']]]]));
// Regression F-2: extras ist dort ein leeres stdClass; das Bereinigen darf daran nicht scheitern
// (vorher "Cannot use object of type stdClass as array", 500 beim Anlegen und Merge).
check('Helfer: frisches Ergebnis ohne result_codes laesst sich bereinigen',
    json_encode(skm_sanitize_submitted_result(skm_submit_error_result(new \RuntimeException('submit_timeout')))) === '{"error":"submit_timeout","detail":{"message":"submit_timeout","extras":{}}}');
check('Helfer: Fehler ohne extras ergibt leeres extras-Objekt (wie Node)',
    json_encode(skm_submit_error_result(new \RuntimeException('submit_timeout'))) === '{"error":"submit_timeout","detail":{"message":"submit_timeout","extras":{}}}');
check('Helfer: Erfolg nur Hash und Ledger',
    skm_submit_success_result(['hash' => 'h', 'ledger' => 3, 'envelope_xdr' => 'X', 'result_xdr' => 'Y']) === ['hash' => 'h', 'ledger' => 3]);
check('Helfer: result_codes nur als Strings, Fremdfelder fallen weg (wie Node)',
    json_encode(skm_sanitize_submitted_result(['error' => ['title' => 'T', 'extras' => ['result_codes' => ['transaction' => 'tx_failed', 'operations' => ['op_underfunded', 5, ['x' => 1]], 'inner_transaction' => 'tx_bad_auth', 'envelope_xdr' => 'OLD_ENVELOPE']]]]))
    === '{"error":"T","detail":{"message":"T","extras":{"result_codes":{"transaction":"tx_failed","inner_transaction":"tx_bad_auth","operations":["op_underfunded"]}}}}');
check('Helfer: null bleibt null', skm_sanitize_submitted_result(null) === null);
// 'a' vorweg: Byte 300 liegt dann mitten in einem 'ä' (2 Byte), ein Kuerzen nach Bytes zerschnitte es.
$longUmlauts = skm_submit_error_result(new \RuntimeException('a' . str_repeat('ä', 400)));
check('Helfer: langer Text mit Umlauten wird nach Zeichen gekuerzt (300 Zeichen, gueltiges UTF-8)',
    $longUmlauts['error'] === 'a' . str_repeat('ä', 299) && mb_check_encoding($longUmlauts['error'], 'UTF-8'));
check('Helfer: gekuerzter Text mit Umlauten laesst sich als JSON ausgeben', json_encode($longUmlauts) !== false);
$longEmoji = skm_submit_error_result(new \RuntimeException(str_repeat('a', 299) . "\u{1F600}x"));
check('Helfer: Emoji an der Grenze bleibt ganz (wie Node)', $longEmoji['error'] === str_repeat('a', 299) . "\u{1F600}" && json_encode($longEmoji) !== false);
check('Helfer: Altjob mit error-Objekt ohne title nimmt detail (wie Node)',
    skm_sanitize_submitted_result(['error' => ['detail' => 'The transaction failed.']])['error'] === 'The transaction failed.');

// --- HTTP ---
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
function storedJob(string $id, KeyPair $owner, int $now, array $extra): array {
    $tx = buildTx($owner, $now, false);
    $xdr = $tx->toEnvelopeXdrBase64();
    return array_merge([
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
        'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600,
        'signers' => [['publicKey' => $owner->getAccountId(), 'weight' => 1]],
        'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1],
        'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
    ], $extra);
}
$mergeTx = buildTx($owner, $now, false);
$mergeUnsignedXdr = $mergeTx->toEnvelopeXdrBase64();
$mergeHash = bin2hex($mergeTx->hash(Network::testnet()));
$mergeTx->sign($owner, Network::testnet());
$mergeSignedXdr = $mergeTx->toEnvelopeXdrBase64();
$oldExtras = ['envelope_xdr' => 'OLD_ENVELOPE', 'result_xdr' => 'OLD_RESULT', 'result_codes' => ['transaction' => 'tx_insufficient_fee']];

$apiDir = sys_get_temp_dir() . '/skm-submitleak-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-submitleak-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:" . STUB_PORT . "'", $networks);
check('sanity: Horizon-URL in der Testkopie ersetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);
file_put_contents($sideDir . '/stub.php', "<?php http_response_code(400); header('Content-Type: application/problem+json');\n"
    . "echo json_encode(['type' => 'https://stellar.org/horizon-errors/transaction_failed', 'title' => 'Transaction Failed', 'status' => 400,"
    . " 'detail' => 'The transaction failed when submitted to the stellar network.',"
    . " 'extras' => ['envelope_xdr' => 'MOCK_ENVELOPE_XDR', 'result_xdr' => 'MOCK_RESULT_XDR', 'result_codes' => ['transaction' => 'tx_insufficient_fee']]]);");

file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => [
    array_merge(storedJob('merge-job', $owner, $now, ['status' => 'pending_signatures']),
        ['txHash' => $mergeHash, 'txXdrOriginal' => $mergeUnsignedXdr, 'txXdrCurrent' => $mergeUnsignedXdr]),
    // Altjob PHP: detail.extras ist die ganze Horizon-Antwort.
    storedJob('old-php', $owner, $now, ['status' => 'submitted_failed',
        'submittedResult' => ['error' => 'Transaction Failed', 'detail' => ['message' => 'Transaction Failed', 'extras' => $oldExtras]]]),
    // Altjob Node-Format: error ist die ganze Horizon-Antwort.
    storedJob('old-node', $owner, $now, ['status' => 'submitted_failed',
        'submittedResult' => ['error' => ['title' => 'Transaction Failed', 'extras' => $oldExtras]]]),
    // Altjob PHP: Erfolg mit envelopeXdr/resultXdr.
    storedJob('old-success', $owner, $now, ['status' => 'submitted_success',
        'submittedResult' => ['hash' => 'abc', 'ledger' => 7, 'envelopeXdr' => 'OLD_ENVELOPE', 'resultXdr' => 'OLD_RESULT']]),
]]));
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

    $res = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => buildTx($owner, $now, true)->toEnvelopeXdrBase64()]);
    check('Anlegen mit Ablehnung: submitted_failed', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submitted_failed');
    check('Anlegen mit Ablehnung: Antwort ohne envelope_xdr/result_xdr', noLeak($res['body']));
    check('Anlegen mit Ablehnung: result_codes bleiben',
        ($res['body']['submittedResult']['detail']['extras']['result_codes']['transaction'] ?? '') === 'tx_insufficient_fee');
    // Horizon liefert title und detail: zuerst title, wie Node (submitErrorResult in services/submitResult.js).
    check('Anlegen mit Ablehnung: Fehlertext ist Horizons title (wie Node)', ($res['body']['submittedResult']['error'] ?? '') === 'Transaction Failed');
    $stored = (string)file_get_contents($apiDir . '/data/multisig_jobs.json');
    check('Anlegen mit Ablehnung: gespeichert ohne MOCK_ENVELOPE_XDR', strpos($stored, 'MOCK_ENVELOPE_XDR') === false);

    $res = request('POST', BASE_URL . '/merge-job/merge-signed-xdr', ['x-job-token: tok-merge-job'], ['signedXdr' => $mergeSignedXdr]);
    check('Merge mit Ablehnung: submitted_failed', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submitted_failed');
    check('Merge mit Ablehnung: Antwort ohne envelope_xdr/result_xdr', noLeak($res['body']));
    check('Merge mit Ablehnung: result_codes bleiben', ($res['body']['submittedResult']['detail']['extras']['result_codes']['transaction'] ?? '') === 'tx_insufficient_fee');
    check('Merge mit Ablehnung: Fehlertext ist Horizons title (wie Node)', ($res['body']['submittedResult']['error'] ?? '') === 'Transaction Failed');
    $stored = (string)file_get_contents($apiDir . '/data/multisig_jobs.json');
    check('Merge mit Ablehnung: gespeichert ohne MOCK_ENVELOPE_XDR', strpos($stored, 'MOCK_ENVELOPE_XDR') === false);

    $res = request('GET', BASE_URL . '?network=testnet&accountId=' . $owner->getAccountId());
    check('Liste: 200', $res['status'] === 200);
    check('Liste: auch Altjobs ohne envelope_xdr/result_xdr', noLeak($res['body']));
    $byId = [];
    foreach ($res['body'] as $j) $byId[$j['id']] = $j;
    check('Liste: Altjob PHP behaelt result_codes', ($byId['old-php']['submittedResult']['detail']['extras']['result_codes']['transaction'] ?? '') === 'tx_insufficient_fee');
    check('Liste: Altjob Node-Format behaelt result_codes und Text',
        ($byId['old-node']['submittedResult']['detail']['extras']['result_codes']['transaction'] ?? '') === 'tx_insufficient_fee'
        && ($byId['old-node']['submittedResult']['error'] ?? '') === 'Transaction Failed');
    check('Liste: Altjob Erfolg nur Hash und Ledger', ($byId['old-success']['submittedResult'] ?? null) === ['hash' => 'abc', 'ledger' => 7]);

    foreach (['old-php', 'old-node', 'old-success'] as $id) {
        $res = request('GET', BASE_URL . '/' . $id, ['x-job-token: tok-' . $id]);
        check("Detail {$id}: ohne envelope_xdr/result_xdr", $res['status'] === 200 && noLeak($res['body']['submittedResult'] ?? null));
    }
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
