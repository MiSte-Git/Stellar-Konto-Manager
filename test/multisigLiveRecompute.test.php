<?php
// Schritt 3 der Fable-Befunde (PHP), Pendant: test/multisigLiveRecompute.test.js.
// - F-8: Anlegen bei Horizon-Ausfall 503 horizon_unavailable, bei unbekanntem Konto 400
//   account_not_found, beide ohne Job.
// - F-9: Merge bei Horizon-Ausfall 502 signers_unavailable, nichts geaendert (wie bisher, Paritaet).
// - F-11: Offene Jobs werden beim Lesen live neu berechnet (Signer, Schwellen, requiredWeight,
//   collected, Status), ohne zu speichern. Bei Horizon-Ausfall gilt der gespeicherte Stand,
//   gespeicherte collectedSigners nur bei nicht lesbarem XDR, Endzustaende ohne Abfrage.
// - Ablehnen und Loeschen entscheiden mit dem neu berechneten Stand.
// Horizon-Zustand aus vorbelegtem signers_cache_v2.json (ok => false mit notFound true/false fuer
// Ausfall bzw. 404). Die Horizon-URL der Testkopie zeigt auf einen geschlossenen lokalen Port, ein
// (falsches) Senden erreicht nie das echte Testnet.
//
// Run with: php test/multisigLiveRecompute.test.php

declare(strict_types=1);

require __DIR__ . '/../api/vendor/autoload.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
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

const TEST_PORT = 3952;
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
function txFor(KeyPair $source, int $now, array $signers = []): \Soneso\StellarSDK\Transaction {
    $tx = (new TransactionBuilder(new Account($source->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder(KeyPair::random()->getAccountId(), Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
    foreach ($signers as $s) $tx->sign($s, Network::testnet());
    return $tx;
}
function sig(KeyPair $k, int $weight = 1): array { return ['publicKey' => $k->getAccountId(), 'weight' => $weight]; }
function job(string $id, KeyPair $source, \Soneso\StellarSDK\Transaction $tx, int $now, array $extra): array {
    $xdr = $tx->toEnvelopeXdrBase64();
    return array_merge([
        'id' => $id, 'accessToken' => 'tok-' . $id, 'network' => 'testnet', 'accountId' => $source->getAccountId(),
        'txHash' => bin2hex($tx->hash(Network::testnet())), 'txXdrOriginal' => $xdr, 'txXdrCurrent' => $xdr,
        'status' => 'pending_signatures', 'createdAt' => gmdate('c'), 'maxTimeUnix' => $now + 3600, 'collectedWeight' => 0,
    ], $extra);
}
function pks(?array $list): array {
    $out = array_map(fn($s) => $s['publicKey'] ?? '', $list ?? []);
    sort($out);
    return $out;
}

$accR = KeyPair::random(); $C = KeyPair::random(); $B = KeyPair::random();
$accL = KeyPair::random(); $accA = KeyPair::random(); $down = KeyPair::random(); $ghost = KeyPair::random();
$txDownMerge = txFor($down, $now);
$t1 = ['low' => 1, 'med' => 1, 'high' => 1];
$t2 = ['low' => 2, 'med' => 2, 'high' => 2];
$t0 = ['low' => 0, 'med' => 0, 'high' => 0];
$items = [
    job('removed', $accR, txFor($accR, $now, [$C]), $now, ['signers' => [sig($accR), sig($C)], 'thresholds' => $t1, 'requiredWeight' => 1, 'collectedSigners' => [sig($C)], 'collectedWeight' => 1]),
    job('legacy', $accL, txFor($accL, $now, [$accL]), $now, ['signers' => [], 'thresholds' => $t0, 'requiredWeight' => 1, 'collectedSigners' => []]),
    job('down-read', $down, txFor($down, $now, [$down]), $now, ['signers' => [sig($down), sig($B)], 'thresholds' => $t2, 'requiredWeight' => 2, 'collectedSigners' => [sig($down)], 'collectedWeight' => 1]),
    job('down-merge', $down, $txDownMerge, $now, ['signers' => [sig($down)], 'thresholds' => $t1, 'requiredWeight' => 1, 'collectedSigners' => []]),
    job('stale-collected', $accA, txFor($accA, $now), $now, ['signers' => [sig($accA), sig($B)], 'thresholds' => $t2, 'requiredWeight' => 2, 'collectedSigners' => [sig($accA)], 'collectedWeight' => 1]),
    array_merge(job('broken-xdr', $accA, txFor($accA, $now), $now, ['signers' => [sig($accA), sig($B)], 'thresholds' => $t2, 'requiredWeight' => 2, 'collectedSigners' => [sig($accA)], 'collectedWeight' => 1]),
        ['txXdrCurrent' => 'kaputt', 'txXdrOriginal' => 'kaputt']),
    job('final', $accR, txFor($accR, $now, [$C]), $now, ['status' => 'submitted_failed', 'signers' => [sig($accR), sig($C)], 'thresholds' => $t1, 'requiredWeight' => 1, 'collectedSigners' => [sig($C)], 'collectedWeight' => 1]),
    job('final-empty', $accL, txFor($accL, $now), $now, ['status' => 'submitted_failed', 'signers' => [], 'thresholds' => $t0, 'requiredWeight' => 1, 'collectedSigners' => []]),
];
$ok = fn(array $signers, array $thr) => ['data' => ['ok' => true, 'signers' => $signers, 'thresholds' => $thr, 'sequence' => '100'], 'fetchedAt' => time() + 3600];
$fail = fn(bool $notFound) => ['data' => ['ok' => false, 'signers' => [], 'thresholds' => $t0, 'sequence' => null, 'notFound' => $notFound], 'fetchedAt' => time() + 3600];
$cache = [
    'testnet:' . $accR->getAccountId() => $ok([sig($accR), sig($B)], $t1),
    'testnet:' . $accL->getAccountId() => $ok([sig($accL), sig($B)], ['low' => 0, 'med' => 2, 'high' => 2]),
    'testnet:' . $accA->getAccountId() => $ok([sig($accA), sig($B)], $t2),
    'testnet:' . $down->getAccountId() => $fail(false),
    'testnet:' . $ghost->getAccountId() => $fail(true),
];

$apiDir = sys_get_temp_dir() . '/skm-liverecompute-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-liverecompute-side-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($sideDir, 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) copy($file, $apiDir . '/' . basename($file));
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
$networks = (string)file_get_contents($apiDir . '/stellarNetworks.php');
$patched = str_replace("'https://horizon-testnet.stellar.org'", "'http://127.0.0.1:9'", $networks);
check('sanity: Horizon-URL in der Testkopie auf einen geschlossenen Port gesetzt', $patched !== $networks);
file_put_contents($apiDir . '/stellarNetworks.php', $patched);
$jobFile = $apiDir . '/data/multisig_jobs.json';
file_put_contents($jobFile, json_encode(['items' => $items]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode($cache));

$stored = function (string $id) use ($jobFile): ?array {
    foreach (json_decode((string)file_get_contents($jobFile), true)['items'] ?? [] as $j) if (($j['id'] ?? '') === $id) return $j;
    return null;
};
$count = fn() => count(json_decode((string)file_get_contents($jobFile), true)['items'] ?? []);
$detail = fn(string $id) => request('GET', BASE_URL . '/' . $id, ['x-job-token: tok-' . $id]);
$signedChallenge = function (string $id, KeyPair $kp, string $purpose): array {
    $ch = request('POST', BASE_URL . "/{$id}/challenge", [], ['signer' => $kp->getAccountId()]);
    $nonce = base64_decode((string)($ch['body']['challenge'] ?? ''), true) ?: '';
    return ['signer' => $kp->getAccountId(), 'signature' => base64_encode($kp->sign('skm:' . $purpose . ':' . $nonce))];
};

$env = array_merge(getenv(), [
    'CHALLENGES_FILE_PATH' => $sideDir . '/challenges.json',
    'MULTISIG_CHALLENGE_RATE_LIMIT_PATH' => $sideDir . '/challenge_rl.json',
    'MULTISIG_JOB_RATE_LIMIT_PATH' => $sideDir . '/job_rl.json',
]);
$null = [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']];
$server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/multisig.php'], $null, $p, $apiDir, $env);

try {
    check('sanity: PHP-Server laeuft', waitFor(TEST_PORT));

    // --- F-8 ---
    $before = $count();
    $res = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $down->getAccountId(), 'txXdr' => txFor($down, $now, [$down])->toEnvelopeXdrBase64()]);
    check('F-8: Anlegen bei Horizon-Ausfall -> 503 horizon_unavailable (wie Node)', $res['status'] === 503 && $res['body'] === ['ok' => false, 'error' => 'horizon_unavailable']);
    check('F-8: Anlegen bei Horizon-Ausfall legt keinen Job an', $count() === $before);
    $res = request('POST', BASE_URL, [], ['network' => 'testnet', 'accountId' => $ghost->getAccountId(), 'txXdr' => txFor($ghost, $now)->toEnvelopeXdrBase64()]);
    check('F-8: Anlegen fuer unbekanntes Konto -> 400 account_not_found (wie Node)', $res['status'] === 400 && $res['body'] === ['ok' => false, 'error' => 'account_not_found']);
    check('F-8: Anlegen fuer unbekanntes Konto legt keinen Job an', $count() === $before);

    // --- F-9 (Paritaet) ---
    $signed = AbstractTransaction::fromEnvelopeBase64XdrString($txDownMerge->toEnvelopeXdrBase64());
    $signed->sign($down, Network::testnet());
    $res = request('POST', BASE_URL . '/down-merge/merge-signed-xdr', ['x-job-token: tok-down-merge'], ['signedXdr' => $signed->toEnvelopeXdrBase64()]);
    check('F-9: Merge bei Horizon-Ausfall -> 502 signers_unavailable (wie Node)', $res['status'] === 502 && ($res['body']['error'] ?? '') === 'signers_unavailable');
    $s = $stored('down-merge');
    check('F-9: Job unveraendert, nicht gesendet', ($s['status'] ?? '') === 'pending_signatures' && ($s['txXdrCurrent'] ?? '') === $txDownMerge->toEnvelopeXdrBase64() && !isset($s['submittedResult']));

    // --- F-11 ---
    $r = $detail('removed')['body'];
    check('F-11: entfernter Signer zaehlt beim Lesen nicht mehr', ($r['collectedWeight'] ?? null) === 0 && ($r['collectedSigners'] ?? null) === [] && ($r['status'] ?? '') === 'pending_signatures');
    check('F-11: Signer und fehlende Signer live', pks($r['signers'] ?? []) === pks([sig($accR), sig($B)]) && pks($r['missingSigners'] ?? []) === pks([sig($accR), sig($B)]));
    $s = $stored('removed');
    check('F-11: beim Lesen nichts gespeichert', pks($s['signers'] ?? []) === pks([sig($accR), sig($C)]) && ($s['collectedWeight'] ?? null) === 1);

    $r = $detail('legacy')['body'];
    check('F-8/F-11: Altjob mit leeren Signern zeigt live noetiges Gewicht 2 und Schwellen',
        ($r['requiredWeight'] ?? null) === 2 && ($r['collectedWeight'] ?? null) === 1 && ($r['status'] ?? '') === 'pending_signatures'
        && ($r['thresholds'] ?? null) === ['low' => 0, 'med' => 2, 'high' => 2] && pks($r['missingSigners'] ?? []) === [$B->getAccountId()]);
    check('F-8/F-11: Altjob gespeichert unveraendert', ($stored('legacy')['requiredWeight'] ?? null) === 1);
    $list = request('GET', BASE_URL . '?network=testnet&accountId=' . $accL->getAccountId())['body'];
    $item = array_values(array_filter($list, fn($j) => ($j['id'] ?? '') === 'legacy'))[0] ?? [];
    check('F-11: Liste rechnet genauso neu wie das Detail', ($item['requiredWeight'] ?? null) === 2 && ($item['status'] ?? '') === 'pending_signatures');

    $r = $detail('down-read')['body'];
    check('F-11: bei Horizon-Ausfall gilt der gespeicherte Stand',
        ($r['requiredWeight'] ?? null) === 2 && ($r['collectedWeight'] ?? null) === 1 && ($r['status'] ?? '') === 'pending_signatures'
        && pks($r['signers'] ?? []) === pks([sig($down), sig($B)]));

    $r = $detail('stale-collected')['body'];
    check('F-11: lesbares XDR ohne Signatur nimmt keine veralteten collectedSigners', ($r['collectedWeight'] ?? null) === 0 && ($r['collectedSigners'] ?? null) === []);
    $res = $detail('broken-xdr');
    check('F-11: nicht lesbares XDR nimmt die gespeicherten collectedSigners', $res['status'] === 200 && ($res['body']['collectedWeight'] ?? null) === 1 && pks($res['body']['collectedSigners'] ?? []) === [$accA->getAccountId()]);

    $r = $detail('final')['body'];
    check('F-11: Endzustand bleibt beim gespeicherten Stand', ($r['status'] ?? '') === 'submitted_failed' && pks($r['signers'] ?? []) === pks([sig($accR), sig($C)]) && ($r['collectedWeight'] ?? null) === 1);
    $r = $detail('final-empty')['body'];
    check('F-11: Endzustand mit leeren Signern ohne Abfrage (keine Live-Signer)', ($r['status'] ?? '') === 'submitted_failed' && ($r['signers'] ?? null) === []);

    // --- Ablehnen und Loeschen ---
    $res = request('POST', BASE_URL . '/legacy/decline', [], $signedChallenge('legacy', $accL, 'decline'));
    check('Ablehnen: Signatur nur im XDR -> 409 already_signed (wie Node)', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'already_signed');
    $res = request('POST', BASE_URL . '/legacy/decline', [], $signedChallenge('legacy', $B, 'decline'));
    check('Ablehnen: noch nicht signierter Signer, live noetiges Gewicht 2 -> rejected (wie Node)', $res['status'] === 200 && ($res['body']['status'] ?? '') === 'rejected');
    check('Ablehnen: gespeichertes requiredWeight live (2)', ($stored('legacy')['requiredWeight'] ?? null) === 2);

    $res = request('POST', BASE_URL . '/removed/delete', [], $signedChallenge('removed', $accR, 'delete'));
    check('Loeschen: offener Job (neu berechnet) -> 409 not_final', $res['status'] === 409 && ($res['body']['error'] ?? '') === 'not_final' && ($res['body']['status'] ?? '') === 'pending_signatures' && $stored('removed') !== null);
    $res = request('POST', BASE_URL . '/final/delete', [], $signedChallenge('final', $accR, 'delete'));
    check('Loeschen: Endzustand wird geloescht', $res['status'] === 200 && $stored('final') === null);
} finally {
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
