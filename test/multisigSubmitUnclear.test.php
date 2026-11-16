<?php
// F-2 (PHP): Unklares Sendeergebnis wird submit_unclear statt submitted_failed. Unklar ist keine
// Antwort, Timeout, 408, 429, >= 500 ohne result_codes oder 2xx ohne Hash. Mit result_codes bleibt es
// eine Ablehnung. Solange submit_unclear: Merge, Ablehnen und Loeschen 409, nie erneutes Senden, die
// Live-Neuberechnung (summarizeJob) und expireStalePendingJobs lassen den Status stehen. Beim Lesen
// (Liste, Detail) klaert das Backend ueber GET /transactions/{hash}, sobald die Sequence verbraucht
// oder maxTime laut Serveruhr vorbei ist, hoechstens 5 Klaerungen je Anfrage. Gefunden ist sofort
// endgueltig, ein 404 erst, wenn Horizon einen Ledger mehr als 60 s nach maxTime meldet (R-1: GET /,
// history_latest_ledger_closed_at, nicht die Serveruhr).
// Horizon ist ein lokaler Stub (POST /transactions, GET /transactions/{hash}, GET /, Verhalten aus Dateien),
// die URL steht nur in der Testkopie von api/stellarNetworks.php. Der Sende-Timeout ist in der
// Testkopie von api/multisig.php auf 1 s gesetzt. Kontodaten aus vorbelegtem signers_cache_v2.json.
// Pendant: test/multisigSubmitUnclear.test.js.
//
// Run with: php test/multisigSubmitUnclear.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';
require __DIR__ . '/../api/submitResult.php';
require __DIR__ . '/../api/submitUnclear.php';
require __DIR__ . '/../api/multisigJobsGuard.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\Asset;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\PaymentOperationBuilder;
use Soneso\StellarSDK\TimeBounds;
use Soneso\StellarSDK\Transaction;
use Soneso\StellarSDK\TransactionBuilder;
use phpseclib3\Math\BigInteger;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) { $passed++; echo "\xE2\x9C\x94 {$description}\n"; }
    else { $failed++; echo "\xE2\x9C\x98 {$description}\n"; }
}

const TEST_PORT = 3955;
const STUB_PORT = 3956;
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

$now = time();

// --- Helfer direkt ---
check('Helfer: Konstanten gleich wie Node', SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST === 5 && SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS === 60
    && !defined('SUBMIT_UNCLEAR_GRACE_SECONDS'));
check('Helfer: keine Antwort ist unklar', skm_submit_response_is_unclear(null, null) === true);
foreach ([408, 429, 500, 502, 503, 504] as $code) {
    check("Helfer: {$code} ohne result_codes ist unklar", skm_submit_response_is_unclear($code, ['title' => 'Timeout']) === true);
}
check('Helfer: 504 mit result_codes ist Ablehnung', skm_submit_response_is_unclear(504, ['extras' => ['result_codes' => ['transaction' => 'tx_failed']]]) === false);
check('Helfer: 400 mit result_codes ist Ablehnung', skm_submit_response_is_unclear(400, ['extras' => ['result_codes' => ['transaction' => 'tx_bad_seq']]]) === false);
check('Helfer: 400 ohne result_codes bleibt Ablehnung', skm_submit_response_is_unclear(400, ['title' => 'Transaction Malformed']) === false);
check('Helfer: 2xx ohne Hash ist unklar', skm_submit_response_is_unclear(200, ['successful' => true]) === true && skm_submit_response_is_unclear(200, null) === true);
check('Helfer: 2xx mit Hash ist nicht unklar', skm_submit_response_is_unclear(200, ['hash' => 'abc']) === false);
check('Helfer: faellig bei verbrauchter Sequence', skm_unclear_resolve_due(true, $now + 3600, $now) === true);
check('Helfer: faellig nach maxTime (Serveruhr, ohne Karenz)', skm_unclear_resolve_due(false, $now - 1, $now) === true);
check('Helfer: nicht faellig genau bei maxTime', skm_unclear_resolve_due(false, $now, $now) === false);
check('Helfer: nicht faellig ohne maxTime', skm_unclear_resolve_due(false, 0, $now) === false);
check('Helfer R-1: Ledger-Zeit lesen', skm_parse_ledger_closed_at('2026-11-15T10:00:00Z') === gmmktime(10, 0, 0, 11, 15, 2026));
$badLedger = true;
foreach ([null, '', 'gestern', 12345, '2026-13-40T99:00:00Z', '2026-02-30T10:00:00Z', '2026-11-15T10:00:00+01:00', '2026-11-15 10:00:00Z'] as $bad) $badLedger = $badLedger && skm_parse_ledger_closed_at($bad) === null;
check('Helfer R-1: unlesbare Ledger-Zeit ergibt null', $badLedger);
check('Helfer R-1: endgueltig erst mit Ledger mehr als 60 s nach maxTime',
    skm_ledger_past_max_time($now, $now + 61) && !skm_ledger_past_max_time($now, $now + 60) && !skm_ledger_past_max_time($now, $now + 5)
    && !skm_ledger_past_max_time($now, $now) && !skm_ledger_past_max_time($now, $now - 600)
    && !skm_ledger_past_max_time($now, null) && !skm_ledger_past_max_time(0, $now));
check('Helfer: Sequence verbraucht (Konto >= Tx)', skm_sequence_consumed(new BigInteger(101), '101') && skm_sequence_consumed(new BigInteger(101), '200')
    && !skm_sequence_consumed(new BigInteger(101), '100') && !skm_sequence_consumed(new BigInteger(101), null));
check('Helfer: gefunden und erfolgreich -> submitted_success (sofort, auch vor Ablauf)',
    skm_unclear_outcome(['kind' => 'found', 'successful' => true, 'hash' => 'h', 'ledger' => 9], true, false) === ['status' => 'submitted_success', 'submittedResult' => ['hash' => 'h', 'ledger' => 9]]);
$failedOutcome = skm_unclear_outcome(['kind' => 'found', 'successful' => false, 'hash' => 'h', 'ledger' => 9], true, false);
check('Helfer: gefunden und nicht erfolgreich -> submitted_failed mit Fehlertext',
    ($failedOutcome['status'] ?? '') === 'submitted_failed' && is_string($failedOutcome['submittedResult']['error'] ?? null));
check('Helfer: 404 nach Ablauf und verbraucht -> obsolete_seq', skm_unclear_outcome(['kind' => 'not_found'], true, true) === ['status' => 'obsolete_seq']);
check('Helfer: 404 nach Ablauf und nicht verbraucht -> expired', skm_unclear_outcome(['kind' => 'not_found'], false, true) === ['status' => 'expired']);
check('Helfer: Sequence verbraucht, 404, Ledger nicht nach maxTime -> null (wie Node)', skm_unclear_outcome(['kind' => 'not_found'], true, false) === null);
check('Helfer: 404 vor Ablauf, nicht verbraucht -> null', skm_unclear_outcome(['kind' => 'not_found'], false, false) === null);
check('Helfer: sonstiger Fehler -> null', skm_unclear_outcome(['kind' => 'error'], true, true) === null);
check('Helfer: ohne successful -> null', skm_unclear_outcome(['kind' => 'found', 'hash' => 'h'], true, true) === null);
$guarded = expireStalePendingJobs([
    ['id' => 'x', 'status' => 'submit_unclear', 'maxTimeUnix' => $now - 999999, 'createdAt' => '2020-01-01T00:00:00Z'],
    ['id' => 'y', 'status' => 'submit_unclear', 'maxTimeUnix' => 0, 'createdAt' => '2020-01-01T00:00:00Z'],
]);
check('expireStalePendingJobs laesst submit_unclear stehen (auch abgelaufen und alt)',
    array_column($guarded, 'status') === ['submit_unclear', 'submit_unclear']);

// --- HTTP ---
function buildTx(KeyPair $owner, int $maxTime, bool $sign): Transaction {
    $tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp(0), (new DateTime())->setTimestamp($maxTime)))
        ->build();
    if ($sign) $tx->sign($owner, Network::testnet());
    return $tx;
}
function hashOf(Transaction $tx): string { return bin2hex($tx->hash(Network::testnet())); }
function sig(KeyPair $kp): array { return ['publicKey' => $kp->getAccountId(), 'weight' => 1, 'type' => 'ed25519_public_key']; }
function job(string $id, KeyPair $owner, Transaction $tx, int $maxTime, array $extra = []): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return array_merge([
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
        'txHash' => hashOf($tx), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => 'submit_unclear', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $maxTime,
        'signers' => [sig($owner)], 'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1],
        'requiredWeight' => 1, 'collectedSigners' => [], 'collectedWeight' => 0,
        'submittedAt' => gmdate('c'),
        'submittedResult' => ['error' => 'submit_timeout', 'detail' => ['message' => 'submit_timeout', 'extras' => new \stdClass()]],
    ], $extra);
}

$acc = [];
foreach (['merge', 'locked', 'b', 'resSuccess', 'resFailed', 'resObsolete', 'resExpired', 'resError', 'notDue', 'early404', 'many', 'lagExpired', 'lagObsolete', 'rootError', 'c1', 'c2', 'c3', 'c4', 'c5'] as $k) $acc[$k] = KeyPair::random();
$future = $now + 3600;
$mergeTx = buildTx($acc['merge'], $future, false);
$mergeUnsigned = $mergeTx->toEnvelopeXdrBase64();
$mergeTx->sign($acc['merge'], Network::testnet());
$mergeSigned = $mergeTx->toEnvelopeXdrBase64();
$lockedTx = buildTx($acc['locked'], $future, true);
$lockedXdr = $lockedTx->toEnvelopeXdrBase64();
$lockedTx->sign($acc['b'], Network::testnet());
$lockedSignedAgain = $lockedTx->toEnvelopeXdrBase64();
$txs = [
    'resSuccess' => buildTx($acc['resSuccess'], $future, true),
    'resFailed' => buildTx($acc['resFailed'], $future, true),
    'resObsolete' => buildTx($acc['resObsolete'], $now - 200, true),
    // Sequence verbraucht, Zeitfenster offen, Horizon meldet 404 (nachhinkender Knoten): bleibt unklar.
    'early404' => buildTx($acc['early404'], $future, true),
    'resExpired' => buildTx($acc['resExpired'], $now - 200, true),
    'resError' => buildTx($acc['resError'], $future, true),
    // Sequence nicht verbraucht, maxTime laut Serveruhr noch nicht erreicht: keine Abfrage.
    'notDue' => buildTx($acc['notDue'], $now + 600, true),
    // R-1: Serveruhr weit nach maxTime, Horizon-Ledger je nach Pruefung davor oder danach.
    'lagExpired' => buildTx($acc['lagExpired'], $now - 3600, true),
    'lagObsolete' => buildTx($acc['lagObsolete'], $now - 3600, true),
    'rootError' => buildTx($acc['rootError'], $now - 3600, true),
];
$manyTxs = [];
for ($i = 0; $i < 6; $i++) $manyTxs[] = buildTx($acc['many'], $now - 200, true);

$items = [
    array_merge(job('merge-job', $acc['merge'], $mergeTx, $future, ['status' => 'pending_signatures', 'submittedAt' => null, 'submittedResult' => null]),
        ['txXdrOriginal' => $mergeUnsigned, 'txXdrCurrent' => $mergeUnsigned]),
    array_merge(job('locked', $acc['locked'], $lockedTx, $future, [
        'signers' => [sig($acc['locked']), sig($acc['b'])],
        'collectedSigners' => [sig($acc['locked'])], 'collectedWeight' => 1,
    ]), ['txXdrOriginal' => $lockedXdr, 'txXdrCurrent' => $lockedXdr]),
    job('res-success', $acc['resSuccess'], $txs['resSuccess'], $future),
    job('res-failed', $acc['resFailed'], $txs['resFailed'], $future),
    job('res-obsolete', $acc['resObsolete'], $txs['resObsolete'], $now - 200),
    job('early-404', $acc['early404'], $txs['early404'], $future),
    job('res-expired', $acc['resExpired'], $txs['resExpired'], $now - 200),
    job('res-error', $acc['resError'], $txs['resError'], $future),
    job('not-due', $acc['notDue'], $txs['notDue'], $now + 600),
    job('lag-expired', $acc['lagExpired'], $txs['lagExpired'], $now - 3600),
    job('lag-obsolete', $acc['lagObsolete'], $txs['lagObsolete'], $now - 3600),
    job('root-error', $acc['rootError'], $txs['rootError'], $now - 3600),
];
foreach ($manyTxs as $i => $t) $items[] = job("many-{$i}", $acc['many'], $t, $now - 200);

$t1 = ['low' => 1, 'med' => 1, 'high' => 1];
$entry = fn(array $signers, string $seq) => ['data' => ['ok' => true, 'signers' => $signers, 'thresholds' => $t1, 'sequence' => $seq], 'fetchedAt' => time() + 3600];
$cache = [
    'testnet:' . $acc['merge']->getAccountId() => $entry([sig($acc['merge'])], '100'),
    'testnet:' . $acc['locked']->getAccountId() => $entry([sig($acc['locked']), sig($acc['b'])], '100'),
    'testnet:' . $acc['resSuccess']->getAccountId() => $entry([sig($acc['resSuccess'])], '101'),
    'testnet:' . $acc['resFailed']->getAccountId() => $entry([sig($acc['resFailed'])], '105'),
    'testnet:' . $acc['resObsolete']->getAccountId() => $entry([sig($acc['resObsolete'])], '101'),
    'testnet:' . $acc['resExpired']->getAccountId() => $entry([sig($acc['resExpired'])], '100'),
    'testnet:' . $acc['resError']->getAccountId() => $entry([sig($acc['resError'])], '101'),
    'testnet:' . $acc['notDue']->getAccountId() => $entry([sig($acc['notDue'])], '100'),
    'testnet:' . $acc['lagExpired']->getAccountId() => $entry([sig($acc['lagExpired'])], '100'),
    'testnet:' . $acc['lagObsolete']->getAccountId() => $entry([sig($acc['lagObsolete'])], '101'),
    'testnet:' . $acc['rootError']->getAccountId() => $entry([sig($acc['rootError'])], '100'),
    'testnet:' . $acc['early404']->getAccountId() => $entry([sig($acc['early404'])], '101'),
    'testnet:' . $acc['many']->getAccountId() => $entry([sig($acc['many'])], '101'),
];
foreach (['c1', 'c2', 'c3', 'c4', 'c5'] as $k) $cache['testnet:' . $acc[$k]->getAccountId()] = $entry([sig($acc[$k])], '100');

$apiDir = sys_get_temp_dir() . '/skm-unclear-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-unclear-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:" . STUB_PORT . "'", $networks);
check('sanity: Horizon-URL in der Testkopie ersetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);
$multisig = (string)file_get_contents($apiDir . '/multisig.php');
$patchedMultisig = str_replace('const HORIZON_SUBMIT_TIMEOUT_SECONDS = 20;', 'const HORIZON_SUBMIT_TIMEOUT_SECONDS = 1;', $multisig);
check('sanity: Sende-Timeout in der Testkopie auf 1 s gesetzt', $patchedMultisig !== $multisig);
file_put_contents($apiDir . '/multisig.php', $patchedMultisig);

file_put_contents($sideDir . '/stub.php', <<<'PHP'
<?php
$side = __DIR__;
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && $path === '/transactions') {
    file_put_contents($side . '/submit.log', "submit\n", FILE_APPEND);
    $spec = json_decode((string)file_get_contents($side . '/submit.json'), true);
    if (!empty($spec['sleep'])) sleep((int)$spec['sleep']);
    http_response_code((int)$spec['status']);
    echo json_encode($spec['body']);
    return;
}
if (preg_match('#^/transactions/([0-9a-f]{64})$#', (string)$path, $m)) {
    file_put_contents($side . '/tx.log', $m[1] . "\n", FILE_APPEND);
    $txs = json_decode((string)file_get_contents($side . '/txs.json'), true);
    $rec = $txs[$m[1]] ?? null;
    if ($rec === null) {
        http_response_code(404);
        echo json_encode(['type' => 'https://stellar.org/horizon-errors/not_found', 'title' => 'Resource Missing', 'status' => 404]);
        return;
    }
    if (isset($rec['status'])) { http_response_code((int)$rec['status']); echo '{}'; return; }
    echo json_encode(['id' => $m[1], 'hash' => $m[1], 'successful' => $rec['successful'], 'ledger' => $rec['ledger']]);
    return;
}
if ($path === '/') {
    file_put_contents($side . '/root.log', "root\n", FILE_APPEND);
    $spec = json_decode((string)file_get_contents($side . '/root.json'), true);
    if (isset($spec['status'])) { http_response_code((int)$spec['status']); echo '{}'; return; }
    echo json_encode($spec);
    return;
}
http_response_code(404);
echo '{}';
PHP);
$setSubmit = fn(array $spec) => file_put_contents($sideDir . '/submit.json', json_encode($spec));
// R-1: Ledger-Zeit von Horizon (GET /), je Pruefung einstellbar. Standard: Ledger bis jetzt aufgenommen.
$iso = fn(int $unix) => gmdate('Y-m-d\TH:i:s\Z', $unix);
$setRoot = fn(array $spec) => file_put_contents($sideDir . '/root.json', json_encode($spec ?: new \stdClass()));
$setRoot(['history_latest_ledger_closed_at' => $iso($now)]);
$setSubmit(['status' => 200, 'body' => ['hash' => 'x']]);
file_put_contents($sideDir . '/txs.json', json_encode([
    hashOf($txs['resSuccess']) => ['successful' => true, 'ledger' => 4242],
    hashOf($txs['resFailed']) => ['successful' => false, 'ledger' => 77],
    hashOf($txs['resError']) => ['status' => 500],
]));
$jobFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobFile, json_encode(['items' => $items]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode($cache));

$stored = function (string $id) use ($jobFile): ?array {
    foreach (json_decode((string)file_get_contents($jobFile), true)['items'] ?? [] as $j) if (($j['id'] ?? '') === $id) return $j;
    return null;
};
$lines = function (string $file) use ($sideDir): array {
    $p = $sideDir . '/' . $file;
    return file_exists($p) ? array_values(array_filter(explode("\n", (string)file_get_contents($p)))) : [];
};
$lookups = fn(string $hash) => count(array_filter($lines('tx.log'), fn($l) => $l === $hash));
$submitCount = fn() => count($lines('submit.log'));
$list = fn(KeyPair $owner, string $query = '') => request('GET', BASE_URL . '?network=testnet&accountId=' . $owner->getAccountId() . $query);
$detail = fn(string $id) => request('GET', BASE_URL . '/' . $id, ['x-job-token: tok-' . $id]);
$byId = function (array $rows, string $id): array {
    foreach ($rows as $r) if (($r['id'] ?? '') === $id) return $r;
    return [];
};
$create = fn(KeyPair $owner) => request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => buildTx($owner, time() + 3600, true)->toEnvelopeXdrBase64()]);
$signedChallenge = function (string $id, KeyPair $kp, string $purpose): array {
    $ch = request('POST', BASE_URL . "/{$id}/challenge", [], ['signer' => $kp->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return ['signer' => $kp->getAccountId(), 'signature' => base64_encode($kp->sign('skm:' . $purpose . ':' . $nonce)), 'challenge' => base64_encode($nonce)];
};

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

    // --- Senden ---
    $setSubmit(['status' => 200, 'body' => ['hash' => 'x'], 'sleep' => 3]);
    $res = $create($acc['c1']);
    check('Anlegen mit Timeout beim Senden: submit_unclear', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submit_unclear');
    check('Anlegen mit Timeout: Fehlertext submit_timeout, extras leer (F-3-Format)',
        ($res['body']['submittedResult']['error'] ?? '') === 'submit_timeout' && ($res['body']['submittedResult']['detail']['extras'] ?? null) === []);
    check('Anlegen mit Timeout: gespeichert als submit_unclear', ($stored($res['body']['id'] ?? '')['status'] ?? '') === 'submit_unclear');
    sleep(3); // Stub ist noch mit dem langsamen Request beschaeftigt

    $setSubmit(['status' => 504, 'body' => ['type' => 'https://stellar.org/horizon-errors/timeout', 'title' => 'Timeout', 'status' => 504]]);
    $res = $create($acc['c2']);
    check('Anlegen mit 504 ohne result_codes: submit_unclear', ($res['body']['status'] ?? '') === 'submit_unclear');
    check('Anlegen mit 504: Fehlertext aus title (wie Node)', ($res['body']['submittedResult']['error'] ?? '') === 'Timeout');

    $setSubmit(['status' => 429, 'body' => ['title' => 'Rate Limit Exceeded']]);
    check('Anlegen mit 429: submit_unclear', ($create($acc['c3'])['body']['status'] ?? '') === 'submit_unclear');
    $setSubmit(['status' => 200, 'body' => ['successful' => true]]);
    $res = $create($acc['c4']);
    check('Anlegen mit 2xx ohne Hash: submit_unclear mit Fehlertext',
        ($res['body']['status'] ?? '') === 'submit_unclear' && is_string($res['body']['submittedResult']['error'] ?? null));

    $setSubmit(['status' => 400, 'body' => ['title' => 'Transaction Failed', 'extras' => ['result_codes' => ['transaction' => 'tx_insufficient_fee']]]]);
    $res = $create($acc['c5']);
    check('Anlegen mit 400 und result_codes: weiterhin submitted_failed',
        ($res['body']['status'] ?? '') === 'submitted_failed'
        && ($res['body']['submittedResult']['detail']['extras']['result_codes']['transaction'] ?? '') === 'tx_insufficient_fee');

    $setSubmit(['status' => 504, 'body' => ['title' => 'Timeout', 'status' => 504]]);
    $res = request('POST', BASE_URL . '/merge-job/merge-signed-xdr', ['x-job-token: tok-merge-job'], ['signedXdr' => $mergeSigned]);
    check('Merge mit 504 beim Senden: submit_unclear', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submit_unclear');
    check('Merge mit 504: Fehlertext aus title', ($res['body']['submittedResult']['error'] ?? '') === 'Timeout');
    $s = $stored('merge-job');
    check('Merge mit 504: gespeichert als submit_unclear mit Signatur', ($s['status'] ?? '') === 'submit_unclear' && ($s['txXdrCurrent'] ?? '') === $mergeSigned);

    // --- Gesperrt solange unklar ---
    $setSubmit(['status' => 200, 'body' => ['hash' => 'x', 'ledger' => 1]]);
    $before = $submitCount();
    $res = request('POST', BASE_URL . '/locked/merge-signed-xdr', ['x-job-token: tok-locked'], ['signedXdr' => $lockedSignedAgain]);
    check('submit_unclear: Merge 409 submit_unclear', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'submit_unclear');
    check('submit_unclear: Merge sendet nicht erneut', $submitCount() === $before);
    check('submit_unclear: Merge aendert nichts', ($stored('locked')['status'] ?? '') === 'submit_unclear' && ($stored('locked')['txXdrCurrent'] ?? '') === $lockedXdr);

    $res = request('POST', BASE_URL . '/locked/decline', [], $signedChallenge('locked', $acc['b'], 'decline'));
    check('submit_unclear: Ablehnen 409 submit_unclear', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'submit_unclear');
    check('submit_unclear: Ablehnen aendert nichts', ($stored('locked')['status'] ?? '') === 'submit_unclear' && !isset($stored('locked')['declinedSigners']));

    $res = request('POST', BASE_URL . '/locked/delete', [], $signedChallenge('locked', $acc['locked'], 'delete'));
    check('submit_unclear: Loeschen 409 not_final (wie Node)', $res['status'] === 409 && $res['body'] === ['ok' => false, 'error' => 'not_final', 'status' => 'submit_unclear']);
    check('submit_unclear: Loeschen laesst den Job stehen', $stored('locked') !== null);

    $l = $list($acc['locked']);
    check('Live-Neuberechnung Liste: voll signiert bleibt submit_unclear', ($byId($l['body'], 'locked')['status'] ?? '') === 'submit_unclear');
    check('Live-Neuberechnung Detail: bleibt submit_unclear', ($detail('locked')['body']['status'] ?? '') === 'submit_unclear');
    check('Live-Neuberechnung: keine Klaerung ohne Faelligkeit', $lookups(hashOf($lockedTx)) === 0);
    $f = $list($acc['locked'], '&status=submit_unclear');
    check('Statusfilter submit_unclear', array_column($f['body'], 'id') === ['locked']);

    $l = $list($acc['notDue']);
    check('Vor maxTime (Serveruhr) und Sequence frei: bleibt submit_unclear', ($byId($l['body'], 'not-due')['status'] ?? '') === 'submit_unclear');
    check('Vor maxTime: keine Klaerung, gespeichert unveraendert',
        $lookups(hashOf($txs['notDue'])) === 0 && ($stored('not-due')['status'] ?? '') === 'submit_unclear');

    // --- Klaerung ---
    $hS = hashOf($txs['resSuccess']);
    $res = $detail('res-success');
    check('Klaerung Detail: gefunden und erfolgreich -> submitted_success', ($res['body']['status'] ?? '') === 'submitted_success');
    check('Klaerung Detail: submittedResult Hash und Ledger', ($res['body']['submittedResult'] ?? null) === ['hash' => $hS, 'ledger' => 4242]);
    check('Klaerung Detail: gespeichert', ($stored('res-success')['status'] ?? '') === 'submitted_success'
        && ($stored('res-success')['submittedResult'] ?? null) === ['hash' => $hS, 'ledger' => 4242]);
    $detail('res-success');
    $list($acc['resSuccess']);
    check('Klaerung: nur einmal abgefragt', $lookups($hS) === 1);

    $l = $list($acc['resFailed']);
    $j = $byId($l['body'], 'res-failed');
    check('Klaerung Liste: gefunden und nicht erfolgreich -> submitted_failed mit Fehlertext',
        ($j['status'] ?? '') === 'submitted_failed' && is_string($j['submittedResult']['error'] ?? null));
    check('Klaerung Liste: submitted_failed gespeichert', ($stored('res-failed')['status'] ?? '') === 'submitted_failed');
    $list($acc['resFailed']);
    check('Klaerung submitted_failed: nur einmal abgefragt', $lookups(hashOf($txs['resFailed'])) === 1);

    $l = $list($acc['early404']);
    check('Klaerung: Sequence verbraucht, 404, Ledger vor maxTime -> bleibt submit_unclear (Liste)', ($byId($l['body'], 'early-404')['status'] ?? '') === 'submit_unclear');
    check('Klaerung: Sequence verbraucht, 404, Ledger vor maxTime -> bleibt submit_unclear (Detail)', ($detail('early-404')['body']['status'] ?? '') === 'submit_unclear');
    check('Klaerung: 404, Ledger vor maxTime wird nicht gespeichert',
        ($stored('early-404')['status'] ?? '') === 'submit_unclear' && !isset($stored('early-404')['resolvedAt']));
    check('Klaerung: 404, Ledger vor maxTime, jede Lese-Anfrage fragt erneut', $lookups(hashOf($txs['early404'])) === 2);

    $l = $list($acc['resObsolete']);
    check('Klaerung: 404 und Sequence verbraucht, Ledger nach maxTime -> obsolete_seq',
        ($byId($l['body'], 'res-obsolete')['status'] ?? '') === 'obsolete_seq' && ($stored('res-obsolete')['status'] ?? '') === 'obsolete_seq');
    $detail('res-obsolete');
    check('Klaerung obsolete_seq: nur einmal abgefragt', $lookups(hashOf($txs['resObsolete'])) === 1);

    $l = $list($acc['resExpired']);
    check('Klaerung: 404, nicht verbraucht, Ledger nach maxTime -> expired',
        ($byId($l['body'], 'res-expired')['status'] ?? '') === 'expired' && ($stored('res-expired')['status'] ?? '') === 'expired');
    $list($acc['resExpired']);
    check('Klaerung expired: nur einmal abgefragt', $lookups(hashOf($txs['resExpired'])) === 1);

    $l = $list($acc['resError']);
    check('Klaerung: sonstiger Fehler -> bleibt submit_unclear',
        ($byId($l['body'], 'res-error')['status'] ?? '') === 'submit_unclear' && ($stored('res-error')['status'] ?? '') === 'submit_unclear');
    check('Klaerung sonstiger Fehler: einmal abgefragt', $lookups(hashOf($txs['resError'])) === 1);

    // --- R-1: Ledger-Zeit statt Serveruhr ---
    $rootCalls = fn() => count($lines('root.log'));
    $setRoot(['history_latest_ledger_closed_at' => $iso($now - 7200)]);
    foreach ([['lagExpired', 'lag-expired'], ['lagObsolete', 'lag-obsolete']] as [$k, $id]) {
        $l = $list($acc[$k]);
        check("R-1: Serveruhr weit nach maxTime, Horizon-Ledger davor -> bleibt submit_unclear ({$id})",
            ($byId($l['body'], $id)['status'] ?? '') === 'submit_unclear' && ($stored($id)['status'] ?? '') === 'submit_unclear'
            && !isset($stored($id)['resolvedAt']));
    }
    $setRoot(['history_latest_ledger_closed_at' => $iso($now - 3600 + 5)]);
    $l = $list($acc['lagExpired']);
    check('R-1: Horizon-Ledger 5 s nach maxTime (innerhalb der Marge) -> bleibt submit_unclear',
        ($byId($l['body'], 'lag-expired')['status'] ?? '') === 'submit_unclear' && ($stored('lag-expired')['status'] ?? '') === 'submit_unclear'
        && ($detail('lag-obsolete')['body']['status'] ?? '') === 'submit_unclear' && ($stored('lag-obsolete')['status'] ?? '') === 'submit_unclear');
    $setRoot(['history_latest_ledger_closed_at' => $iso($now - 3600 + 61)]);
    $l = $list($acc['lagExpired']);
    check('R-1: Horizon-Ledger 61 s nach maxTime -> expired',
        ($byId($l['body'], 'lag-expired')['status'] ?? '') === 'expired' && ($stored('lag-expired')['status'] ?? '') === 'expired');
    check('R-1: Horizon-Ledger 61 s nach maxTime, Sequence verbraucht -> obsolete_seq (Detail)',
        ($detail('lag-obsolete')['body']['status'] ?? '') === 'obsolete_seq' && ($stored('lag-obsolete')['status'] ?? '') === 'obsolete_seq');
    foreach ([['history_latest_ledger_closed_at' => $iso($now - 3600)], [], ['history_latest_ledger_closed_at' => 'kaputt'], ['status' => 503]] as $spec) {
        $setRoot($spec);
        $l = $list($acc['rootError']);
        check('R-1: Ledger genau bei maxTime, ohne, kaputte Ledger-Zeit oder Root-Fehler -> bleibt unklar ' . json_encode($spec),
            ($byId($l['body'], 'root-error')['status'] ?? '') === 'submit_unclear' && ($stored('root-error')['status'] ?? '') === 'submit_unclear');
    }
    $setRoot(['history_latest_ledger_closed_at' => $iso($now)]);
    $before = $rootCalls();
    $list($acc['notDue']);
    check('R-1: nicht faellig, keine Root-Abfrage', $rootCalls() === $before);
    $list($acc['early404']);
    check('R-1: faellig mit 404, eine Root-Abfrage', $rootCalls() === $before + 1);

    $manyHashes = array_map('hashOf', $manyTxs);
    $countMany = fn() => count(array_filter($lines('tx.log'), fn($l) => in_array($l, $manyHashes, true)));
    $rootBefore = $rootCalls();
    $first = $list($acc['many']);
    check('Grenze: hoechstens 5 Klaerungen je Anfrage', $countMany() === 5);
    check('Grenze: fuenf 404, eine Root-Abfrage je Anfrage', $rootCalls() === $rootBefore + 1);
    check('Grenze: 5 geklaert, 1 bleibt unklar',
        count(array_filter($first['body'], fn($j) => ($j['status'] ?? '') === 'obsolete_seq')) === 5
        && count(array_filter($first['body'], fn($j) => ($j['status'] ?? '') === 'submit_unclear')) === 1);
    $second = $list($acc['many']);
    check('Grenze: naechste Anfrage klaert den Rest', $countMany() === 6
        && count(array_filter($second['body'], fn($j) => ($j['status'] ?? '') === 'obsolete_seq')) === 6);
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
