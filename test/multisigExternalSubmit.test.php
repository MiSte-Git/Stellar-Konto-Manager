<?php
// ADR 0014 (PHP): Ein Job, der ausserhalb von SKM gesendet wurde, wird beim Lesen ueber den txHash geklaert.
// Kandidaten: gespeichert offen (pending_signatures, ready_to_submit) oder expired/obsolete_seq/rejected ohne
// ledgerCheckedAt, jeweils nur bei verbrauchter Sequence. Gefunden: submitted_success bzw. submitted_failed mit
// submittedExternally, Ledger und Zeit aus Horizon. Sicherer 404 (R-1, Ledger-Zeit mehr als 60 s nach maxTime):
// offene Jobs obsolete_seq, Endzustaende bleiben, beides mit ledgerCheckedAt. Sonst nichts speichern, beim
// naechsten Lesen erneut. Gemeinsames Budget von 5 mit submit_unclear, Reihenfolge nach
// skm_compare_resolve_priority. Geloeschter oder geaenderter Job unter dem Lock: nichts speichern. Anlegen lehnt tote
// Transaktionen ab (ES-1), Loeschen eines Kandidaten mit verbrauchter Sequence ergibt 409 ledger_check_pending (ES-3),
// Konto unbekannt zaehlt als verbrauchte Sequence (ES-4). Unsignierte Jobs verdraengen signierte nicht (ES-2), Liste und
// Detail tragen ledgerCheckPending (ES-8). Gesendet wird nie.
// Faelle aus test/assets/external-submit.json (routeCases). Horizon ist ein lokaler Stub (GET /transactions/{hash},
// GET /, POST /transactions wird nur gezaehlt), die URL steht nur in der Testkopie von api/stellarNetworks.php.
// Kontodaten aus vorbelegtem signers_cache_v2.json. Die Ledger-Zeit von Horizon liegt bei jetzt + 2000 s; offene
// Jobs mit ledgerPast haben maxTime jetzt + 1000 s. So setzt der Waechter (Serveruhr, bei jedem Speichern) sie
// zwischen den Faellen nicht auf expired, R-1 entscheidet trotzdem. Zwei Worker (PHP_CLI_SERVER_WORKERS), damit
// waehrend einer verzoegerten Abfrage geloescht werden kann.
// Pendant: test/multisigExternalSubmit.test.js.
//
// Run with: php test/multisigExternalSubmit.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

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

const TEST_PORT = 3979;
const STUB_PORT = 3980;
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

function withChallenge(string $jobId, KeyPair $signer, string $purpose): array {
    $ch = request('POST', BASE_URL . "/{$jobId}/challenge", [], ['signer' => $signer->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return request('POST', BASE_URL . "/{$jobId}/{$purpose}", [], [
        'signer' => $signer->getAccountId(),
        'signature' => base64_encode($signer->sign("skm:{$purpose}:" . $nonce)),
        'challenge' => base64_encode($nonce),
    ]);
}

$now = time();
$ledgerNow = $now + 2000;
$fixture = json_decode((string)file_get_contents(__DIR__ . '/assets/external-submit.json'), true);

// $source: Tx-Quelle (Standard $owner; ein anderes Konto bildet einen Altjob von vor K1 nach, ES-11).
// $signers: wer signiert (Standard $owner; [] fuer einen unsignierten Job, ES-2).
function buildTx(KeyPair $owner, int $maxTime, ?KeyPair $source = null, ?array $signers = null): Transaction {
    $tx = (new TransactionBuilder(new Account(($source ?? $owner)->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp(0), (new DateTime())->setTimestamp($maxTime)))
        ->build();
    foreach ($signers ?? [$owner] as $kp) $tx->sign($kp, Network::testnet());
    return $tx;
}
function hashOf(Transaction $tx): string { return bin2hex($tx->hash(Network::testnet())); }
function sig(KeyPair $kp): array { return ['publicKey' => $kp->getAccountId(), 'weight' => 1, 'type' => 'ed25519_public_key']; }
function seedJob(string $id, KeyPair $owner, Transaction $tx, int $maxTime, string $status, array $extra = []): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return array_merge([
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $owner->getAccountId(),
        'txHash' => hashOf($tx), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => $status, 'createdAt' => gmdate('c'), 'maxTimeUnix' => $maxTime,
        'signers' => [sig($owner)], 'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1],
        'requiredWeight' => 1, 'collectedSigners' => [sig($owner)], 'collectedWeight' => 1,
    ], $extra);
}
$entry = fn(KeyPair $kp, string $seq) => [
    'data' => ['ok' => true, 'signers' => [sig($kp)], 'thresholds' => ['low' => 1, 'med' => 1, 'high' => 1], 'sequence' => $seq],
    'fetchedAt' => time() + 3600,
];

$items = [];
$cache = [];
$txs = [];
// --- Faelle aus der Fixture ---
$cases = [];
foreach ($fixture['routeCases'] as $i => $c) {
    $owner = KeyPair::random();
    $source = !empty($c['txSourceDiffers']) ? KeyPair::random() : $owner;
    $maxTime = $now + (int)($c['maxTimeOffset'] ?? ($c['ledgerPast'] ? 1000 : 3600));
    $tx = buildTx($owner, $maxTime, $source);
    $hash = hashOf($tx);
    $extra = $c['storedExtra'] ?? [];
    if ($c['storedStatus'] === 'submitted_success') {
        $extra += ['submittedAt' => gmdate('c'), 'submittedResult' => ['hash' => $hash, 'ledger' => 1]];
    }
    $id = "case-{$i}";
    $items[] = seedJob($id, $owner, $tx, $maxTime, $c['storedStatus'], $extra);
    // Konto unbekannt (ES-4): kein Cache-Eintrag, der Stub antwortet auf GET /accounts/{id} mit 404.
    if (!empty($c['txSourceDiffers'])) {
        // ES-11: Altjob von vor K1. sequenceConsumed gilt fuer die Tx-Quelle, accountIdSequenceConsumed fuer accountId.
        $cache['testnet:' . $owner->getAccountId()] = $entry($owner, !empty($c['accountIdSequenceConsumed']) ? '101' : '100');
        $cache['testnet:' . $source->getAccountId()] = $entry($source, $c['sequenceConsumed'] ? '101' : '100');
    } elseif (empty($c['accountNotFound'])) {
        $cache['testnet:' . $owner->getAccountId()] = $entry($owner, $c['sequenceConsumed'] ? '101' : '100');
    }
    if (isset($c['horizon']['record'])) {
        $txs[$hash] = ['hash' => $hash] + json_decode(str_replace('$JOB_HASH', $hash, (string)json_encode($c['horizon']['record'])), true);
    }
    if (isset($c['horizon']['status'])) $txs[$hash] = ['status' => $c['horizon']['status']];
    $cases[] = $c + ['id' => $id, 'owner' => $owner, 'hash' => $hash];
}

// --- Budget und Reihenfolge: ein Konto, alle Sequences verbraucht (wie im Node-Test) ---
$many = KeyPair::random();
$undecided = [];
foreach ([4400, 4300, 4200, 4100, 4000] as $i => $d) {
    $undecided[$i] = buildTx($many, $now + $d);
    $items[] = seedJob("undecided-{$i}", $many, $undecided[$i], $now + $d, 'pending_signatures');
}
$decidable = [];
foreach ([$now - 3000, $now - 3600] as $i => $t) {
    $decidable[$i] = buildTx($many, $t);
    $items[] = seedJob("decidable-{$i}", $many, $decidable[$i], $t, 'expired');
}
$unclearTx = buildTx($many, $now + 5000);
$items[] = seedJob('unclear', $many, $unclearTx, $now + 5000, 'submit_unclear', [
    'submittedAt' => gmdate('c'),
    'submittedResult' => ['error' => 'submit_timeout', 'detail' => ['message' => 'submit_timeout', 'extras' => new \stdClass()]],
]);
$cache['testnet:' . $many->getAccountId()] = $entry($many, '101');
$txs[hashOf($unclearTx)] = ['hash' => hashOf($unclearTx), 'successful' => true, 'ledger' => 900, 'created_at' => '2026-11-16T12:00:00Z'];

// --- Geloeschter Job: Abfrage verzoegert (2 s), waehrenddessen geloescht. Das Loeschen sieht einen nachhinkenden
// Horizon-Stand (Sequence dort noch nicht verbraucht), sonst lehnte es den ungeprueften Kandidaten ab (ES-3). ---
$delOwner = KeyPair::random();
$delTx = buildTx($delOwner, $now - 3600);
$items[] = seedJob('deleted', $delOwner, $delTx, $now - 3600, 'expired');
$cache['testnet:' . $delOwner->getAccountId()] = $entry($delOwner, '101');
$txs[hashOf($delTx)] = ['hash' => hashOf($delTx), 'successful' => true, 'ledger' => 901, 'created_at' => '2026-11-16T12:00:00Z', 'sleep' => 2];
// --- Status geaendert: Abfrage verzoegert, waehrenddessen speichert der Merge obsolete_seq ---
$raceOwner = KeyPair::random();
$raceTx = buildTx($raceOwner, $now + 3600);
$items[] = seedJob('race', $raceOwner, $raceTx, $now + 3600, 'pending_signatures');
$cache['testnet:' . $raceOwner->getAccountId()] = $entry($raceOwner, '101');
$txs[hashOf($raceTx)] = ['hash' => hashOf($raceTx), 'successful' => true, 'ledger' => 902, 'created_at' => '2026-11-16T12:00:00Z', 'sleep' => 2];
// --- ES-3: ungeklaerter Kandidat mit verbrauchter Sequence, Gegenprobe ohne ---
$pendOwner = KeyPair::random();
$items[] = seedJob('pending-check', $pendOwner, buildTx($pendOwner, $now + 3600), $now + 3600, 'rejected');
$cache['testnet:' . $pendOwner->getAccountId()] = $entry($pendOwner, '101');
$freeOwner = KeyPair::random();
$items[] = seedJob('free', $freeOwner, buildTx($freeOwner, $now + 3600), $now + 3600, 'rejected');
$cache['testnet:' . $freeOwner->getAccountId()] = $entry($freeOwner, '100');
// --- ES-2: untergeschobene unsignierte Jobs mit derselben Sequence und maxTime vor der des echten Jobs (nach der
// Ledger-Zeit des Tests, also nicht sicher geklaert). Echter Job signiert: wird trotzdem zuerst geprueft. Gegenprobe:
// echter Job ohne Signatur, dann verdraengen ihn die fuenf (wie im Node-Test). ---
$victimSigner = KeyPair::random();
$victimEntry = fn(KeyPair $acc) => [
    'data' => ['ok' => true, 'signers' => [sig($victimSigner)], 'thresholds' => ['low' => 2, 'med' => 2, 'high' => 2], 'sequence' => '101'],
    'fetchedAt' => time() + 3600,
];
$planted = function (KeyPair $acc, string $tag) use ($now, &$items): array {
    $out = [];
    foreach ([2100, 2200, 2300, 2400, 2500] as $i => $d) {
        $t = buildTx($acc, $now + $d, null, []);
        $items[] = seedJob("planted-{$tag}-{$i}", $acc, $t, $now + $d, 'pending_signatures', ['collectedSigners' => [], 'collectedWeight' => 0]);
        $out[] = $t;
    }
    return $out;
};
$victim = KeyPair::random();
$plantedVictim = $planted($victim, 'v');
$victimJobTx = buildTx($victim, $now + 3600, null, [$victimSigner]);
$items[] = seedJob('victim-signed', $victim, $victimJobTx, $now + 3600, 'pending_signatures', [
    'signers' => [sig($victimSigner)], 'thresholds' => ['low' => 2, 'med' => 2, 'high' => 2],
    'requiredWeight' => 2, 'collectedSigners' => [sig($victimSigner)], 'collectedWeight' => 1,
]);
$victimUnsigned = KeyPair::random();
$plantedUnsigned = $planted($victimUnsigned, 'u');
$victimUnsignedTx = buildTx($victimUnsigned, $now + 3600, null, []);
$items[] = seedJob('victim-unsigned', $victimUnsigned, $victimUnsignedTx, $now + 3600, 'pending_signatures', ['collectedSigners' => [], 'collectedWeight' => 0]);
$cache['testnet:' . $victim->getAccountId()] = $victimEntry($victim);
$cache['testnet:' . $victimUnsigned->getAccountId()] = $victimEntry($victimUnsigned);
$txs[hashOf($victimJobTx)] = ['hash' => hashOf($victimJobTx), 'successful' => true, 'ledger' => 903, 'created_at' => '2026-11-16T12:00:00Z'];
$txs[hashOf($victimUnsignedTx)] = ['hash' => hashOf($victimUnsignedTx), 'successful' => true, 'ledger' => 904, 'created_at' => '2026-11-16T12:00:00Z'];
// --- ES-1: Anlegen mit toter Transaktion ---
$deadSeqOwner = KeyPair::random();
$cache['testnet:' . $deadSeqOwner->getAccountId()] = $entry($deadSeqOwner, '101');
$deadTimeOwner = KeyPair::random();
$cache['testnet:' . $deadTimeOwner->getAccountId()] = $entry($deadTimeOwner, '100');

$apiDir = sys_get_temp_dir() . '/skm-external-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-external-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:" . STUB_PORT . "'", $networks);
check('sanity: Horizon-URL in der Testkopie ersetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);

file_put_contents($sideDir . '/stub.php', <<<'PHP'
<?php
$side = __DIR__;
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && $path === '/transactions') {
    file_put_contents($side . '/submit.log', "submit\n", FILE_APPEND);
    echo json_encode(['hash' => str_repeat('c', 64), 'ledger' => 1]);
    return;
}
if (preg_match('#^/transactions/([0-9a-f]{64})$#', (string)$path, $m)) {
    file_put_contents($side . '/tx.log', $m[1] . "\n", FILE_APPEND);
    $txs = json_decode((string)file_get_contents($side . '/txs.json'), true);
    $rec = $txs[$m[1]] ?? null;
    if ($rec !== null && isset($rec['sleep'])) { sleep((int)$rec['sleep']); unset($rec['sleep']); }
    if ($rec === null) {
        http_response_code(404);
        echo json_encode(['type' => 'https://stellar.org/horizon-errors/not_found', 'title' => 'Resource Missing', 'status' => 404]);
        return;
    }
    if (isset($rec['status'])) { http_response_code((int)$rec['status']); echo '{}'; return; }
    echo json_encode(['id' => $m[1]] + $rec);
    return;
}
if ($path === '/') {
    echo (string)file_get_contents($side . '/root.json');
    return;
}
http_response_code(404);
echo '{}';
PHP);
file_put_contents($sideDir . '/txs.json', json_encode($txs));
file_put_contents($sideDir . '/root.json', json_encode(['history_latest_ledger_closed_at' => gmdate('Y-m-d\TH:i:s\Z', $ledgerNow)]));
$jobsFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobsFile, json_encode(['items' => $items]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode($cache));

$env = array_merge(getenv(), [
    'PHP_CLI_SERVER_WORKERS' => '2',
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
    'MULTISIG_JOB_LIST_RATE_LIMIT_PATH' => $sideDir . '/job_list_rl.json',
]);
$null = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$stub = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . STUB_PORT, $sideDir . '/stub.php'], $null, $p1, $sideDir, array_merge(getenv(), ['PHP_CLI_SERVER_WORKERS' => '2']));
$server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'], $null, $p2, $apiDir, $env);

$lookupLines = function () use ($sideDir): array {
    $log = $sideDir . '/tx.log';
    return file_exists($log) ? array_values(array_filter(explode("\n", (string)file_get_contents($log)))) : [];
};
$lookups = fn(string $hash): int => count(array_filter($lookupLines(), fn($l) => $l === $hash));
$stored = function (string $id) use ($jobsFile): ?array {
    $data = json_decode((string)file_get_contents($jobsFile), true) ?: [];
    foreach ($data['items'] ?? [] as $j) if (($j['id'] ?? '') === $id) return $j;
    return null;
};
$list = fn(KeyPair $owner) => request('GET', BASE_URL . '?network=testnet&accountId=' . $owner->getAccountId());
$detail = fn(string $id) => request('GET', BASE_URL . '/' . $id, ['x-job-token: tok-' . $id]);
$find = function (array $rows, string $id): ?array {
    foreach ($rows as $r) if (($r['id'] ?? '') === $id) return $r;
    return null;
};

try {
    check('sanity: Horizon-Stub und PHP-Server laufen', waitFor(STUB_PORT) && waitFor(TEST_PORT));

    foreach ($cases as $c) {
        $n = 'Route: ' . $c['name'];
        $e = $c['expected'];
        $l = $list($c['owner']);
        $fromList = $find($l['body'], $c['id']) ?? [];
        $d = $detail($c['id']);
        $s = $stored($c['id']) ?? [];
        check("{$n}: Status in Liste und Detail", $l['status'] === 200 && ($fromList['status'] ?? '') === $e['status']
            && $d['status'] === 200 && ($d['body']['status'] ?? '') === $e['status']);
        check("{$n}: Abfragen nach zwei Lese-Anfragen ({$e['lookups']})", $lookups($c['hash']) === $e['lookups']);
        check("{$n}: gespeichert {$e['stored']}", ($s['status'] ?? '') === $e['stored']);
        check("{$n}: ledgerCheckedAt", !empty($s['ledgerCheckedAt']) === $e['ledgerChecked']);
        check("{$n}: submittedExternally (Datei, Liste, Detail)",
            (($s['submittedExternally'] ?? null) === true) === $e['submittedExternally']
            && (($fromList['submittedExternally'] ?? null) === true) === $e['submittedExternally']
            && (($d['body']['submittedExternally'] ?? null) === true) === $e['submittedExternally']);
        // ES-8: nur in der Antwort, nie gespeichert.
        check("{$n}: ledgerCheckPending in Liste und Detail, nicht gespeichert",
            ($fromList['ledgerCheckPending'] ?? null) === $e['ledgerCheckPending']
            && ($d['body']['ledgerCheckPending'] ?? null) === $e['ledgerCheckPending']
            && !array_key_exists('ledgerCheckPending', $s));
        if (isset($e['submittedAt'])) {
            check("{$n}: submittedAt aus Horizon", ($s['submittedAt'] ?? null) === $e['submittedAt'] && ($fromList['submittedAt'] ?? null) === $e['submittedAt']);
        }
        if ($e['status'] === 'submitted_success' && $e['submittedExternally']) {
            check("{$n}: submittedResult im F-3-Format", ($d['body']['submittedResult'] ?? null) === ['hash' => $c['hash'], 'ledger' => $e['ledger']]
                && ($fromList['submittedResult'] ?? null) === ['hash' => $c['hash'], 'ledger' => $e['ledger']]);
        }
        if ($e['status'] === 'submitted_failed') {
            check("{$n}: Fehlertext", ($d['body']['submittedResult']['error'] ?? '') === 'Transaction Failed'
                && ($d['body']['submittedResult']['detail']['extras'] ?? null) === []);
        }
    }

    // Budget und Reihenfolge
    $before = count($lookupLines());
    $l = $list($many);
    $order = array_slice($lookupLines(), $before);
    check('Budget: hoechstens 5 Abfragen je Anfrage', count($order) === 5);
    check('Budget: unklar zuerst, dann aelteste entscheidbare', array_slice($order, 0, 3) === [hashOf($unclearTx), hashOf($decidable[1]), hashOf($decidable[0])]);
    check('Budget: dann aelteste maxTime', array_slice($order, 3) === [hashOf($undecided[4]), hashOf($undecided[3])]);
    check('Budget: submit_unclear geklaert', ($stored('unclear')['status'] ?? '') === 'submitted_success'
        && ($find($l['body'], 'unclear')['status'] ?? '') === 'submitted_success');
    check('Budget: entscheidbare geprueft, expired wird obsolete_seq (Sequence verbraucht, ES-6)',
        ($stored('decidable-0')['status'] ?? '') === 'obsolete_seq' && !empty($stored('decidable-0')['ledgerCheckedAt'])
        && ($stored('decidable-1')['status'] ?? '') === 'obsolete_seq' && !empty($stored('decidable-1')['ledgerCheckedAt']));
    $before2 = count($lookupLines());
    $list($many);
    check('Budget: naechste Anfrage nur noch die offenen, aelteste zuerst', array_slice($lookupLines(), $before2) === [
        hashOf($undecided[4]), hashOf($undecided[3]), hashOf($undecided[2]), hashOf($undecided[1]), hashOf($undecided[0]),
    ]);

    // Geloeschter Job waehrend der Abfrage
    $mh = curl_multi_init();
    $ch = curl_init(BASE_URL . '/deleted');
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['x-job-token: tok-deleted']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_multi_add_handle($mh, $ch);
    $startedAt = microtime(true);
    do { curl_multi_exec($mh, $running); curl_multi_select($mh, 0.05); } while (microtime(true) - $startedAt < 0.6);
    $cacheFile = $apiDir . '/data/signers_cache_v2.json';
    $cacheNow = json_decode((string)file_get_contents($cacheFile), true);
    $lagging = $cacheNow;
    $lagging['testnet:' . $delOwner->getAccountId()] = $entry($delOwner, '100');
    file_put_contents($cacheFile, json_encode($lagging));
    $del = withChallenge('deleted', $delOwner, 'delete');
    file_put_contents($cacheFile, json_encode($cacheNow));
    do { curl_multi_exec($mh, $running); curl_multi_select($mh, 0.05); } while ($running > 0);
    $pending = json_decode((string)curl_multi_getcontent($ch), true) ?? [];
    curl_multi_remove_handle($mh, $ch);
    curl_multi_close($mh);
    check('Geloescht: Loeschen waehrend der Abfrage gelingt', $del['status'] === 200);
    check('Geloescht: abgefragt', $lookups(hashOf($delTx)) === 1);
    check('Geloescht: nicht wieder angelegt', $stored('deleted') === null);
    check('Geloescht: Antwort ohne Ergebnis', ($pending['status'] ?? '') === 'expired' && ($pending['submittedExternally'] ?? null) !== true);

    // Status geaendert waehrend der Abfrage (Merge speichert obsolete_seq)
    $mh = curl_multi_init();
    $ch = curl_init(BASE_URL . '/race');
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['x-job-token: tok-race']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_multi_add_handle($mh, $ch);
    $startedAt = microtime(true);
    do { curl_multi_exec($mh, $running); curl_multi_select($mh, 0.05); } while (microtime(true) - $startedAt < 0.6);
    $merged = request('POST', BASE_URL . '/race/merge-signed-xdr', ['x-job-token: tok-race'], ['signedXdr' => $raceTx->toEnvelopeXdrBase64()]);
    do { curl_multi_exec($mh, $running); curl_multi_select($mh, 0.05); } while ($running > 0);
    $racePending = json_decode((string)curl_multi_getcontent($ch), true) ?? [];
    curl_multi_remove_handle($mh, $ch);
    curl_multi_close($mh);
    check('Race: Merge waehrend der Abfrage speichert obsolete_seq (409)', $merged['status'] === 409 && ($merged['body']['error'] ?? '') === 'obsolete_seq');
    check('Race: abgefragt', $lookups(hashOf($raceTx)) === 1);
    check('Race: Stand des Merge bleibt, ohne Marker und ohne Ergebnis',
        ($stored('race')['status'] ?? '') === 'obsolete_seq' && empty($stored('race')['ledgerCheckedAt'])
        && ($stored('race')['submittedExternally'] ?? null) !== true && ($racePending['submittedExternally'] ?? null) !== true);
    $again = $detail('race');
    check('Race: naechstes Lesen klaert den Job', ($again['body']['status'] ?? '') === 'submitted_success'
        && ($stored('race')['submittedExternally'] ?? null) === true);

    // ES-3
    $res = withChallenge('pending-check', $pendOwner, 'delete');
    check('ES-3: Loeschen eines ungeprueften Kandidaten mit verbrauchter Sequence: 409 ledger_check_pending',
        $res['status'] === 409 && ($res['body']['error'] ?? '') === 'ledger_check_pending' && $stored('pending-check') !== null);
    $free = withChallenge('free', $freeOwner, 'delete');
    check('ES-3 Gegenprobe: Sequence nicht verbraucht, loeschbar', $free['status'] === 200 && $stored('free') === null);

    // ES-2
    $before = count($lookupLines());
    $l = $list($victim);
    $order = array_slice($lookupLines(), $before);
    $row = $find($l['body'], 'victim-signed') ?? [];
    check('ES-2: fuenf Abfragen, signierter Job zuerst', count($order) === 5 && ($order[0] ?? '') === hashOf($victimJobTx));
    check('ES-2: signierter Job geklaert', ($stored('victim-signed')['status'] ?? '') === 'submitted_success'
        && ($row['status'] ?? '') === 'submitted_success' && ($row['ledgerCheckPending'] ?? null) === false);
    $plantedRows = array_values(array_filter($l['body'], fn($r) => str_starts_with((string)($r['id'] ?? ''), 'planted-v-')));
    check('ES-2: untergeschobene bleiben Kandidaten, ledgerCheckPending', count($plantedRows) === 5
        && count(array_filter($plantedRows, fn($r) => ($r['ledgerCheckPending'] ?? null) === true)) === 5
        && ($stored('planted-v-0')['status'] ?? '') === 'pending_signatures');
    $before = count($lookupLines());
    $l = $list($victimUnsigned);
    $order = array_slice($lookupLines(), $before);
    $row = $find($l['body'], 'victim-unsigned') ?? [];
    check('ES-2 Gegenprobe: unsignierter echter Job hinter den fuenf mit frueherer maxTime',
        $order === array_map('hashOf', $plantedUnsigned) && $lookups(hashOf($victimUnsignedTx)) === 0);
    check('ES-2 Gegenprobe: Anzeige obsolete_seq mit ledgerCheckPending, gespeichert offen',
        ($row['status'] ?? '') === 'obsolete_seq' && ($row['ledgerCheckPending'] ?? null) === true
        && ($stored('victim-unsigned')['status'] ?? '') === 'pending_signatures');

    // ES-1
    $countJobs = fn() => count(json_decode((string)file_get_contents($jobsFile), true)['items'] ?? []);
    $before = $countJobs();
    $seqRes = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $deadSeqOwner->getAccountId(), 'txXdr' => buildTx($deadSeqOwner, $now + 3600)->toEnvelopeXdrBase64()]);
    check('ES-1: verbrauchte Sequence: 409 tx_not_viable obsolete_seq', $seqRes['status'] === 409
        && ($seqRes['body']['error'] ?? '') === 'tx_not_viable' && ($seqRes['body']['status'] ?? '') === 'obsolete_seq');
    $timeRes = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $deadTimeOwner->getAccountId(), 'txXdr' => buildTx($deadTimeOwner, $now - 10)->toEnvelopeXdrBase64()]);
    check('ES-1: abgelaufene maxTime: 409 tx_not_viable expired', $timeRes['status'] === 409
        && ($timeRes['body']['error'] ?? '') === 'tx_not_viable' && ($timeRes['body']['status'] ?? '') === 'expired');
    check('ES-1: kein Job angelegt', $countJobs() === $before);

    check('Es wird nie gesendet', !file_exists($sideDir . '/submit.log'));
} finally {
    proc_terminate($server);
    proc_terminate($stub);
    proc_close($server);
    proc_close($stub);
    exec('rm -rf ' . escapeshellarg($apiDir) . ' ' . escapeshellarg($sideDir));
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
