<?php
// R-5 (PHP): Das Backend sendet Job-Transaktionen ohne SEP-29-Pruefung, wie Node (skipMemoRequiredCheck):
// Ein Ziel, das ein Memo verlangt, oder ein Zielkonto, das sich nicht laden liesse, aendert nichts am
// Senden, und es gibt keine Abfrage des Zielkontos. Horizon ist ein lokaler Stub (protokolliert jede
// Anfrage), die URL steht nur in der Testkopie von api/stellarNetworks.php. Kontodaten aus vorbelegtem
// signers_cache_v2.json. Pendant: test/multisigSubmitNoMemoCheck.test.js.
//
// Run with: php test/multisigSubmitNoMemoCheck.test.php

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

const TEST_PORT = 3963;
const STUB_PORT = 3964;
const BASE_URL = 'http://127.0.0.1:' . TEST_PORT . '/api/multisig/jobs';

function request(string $method, string $url, ?array $body = null): array {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    $headers = [];
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
$memoDest = KeyPair::random()->getAccountId();
$brokenDest = KeyPair::random()->getAccountId();
$now = time();
$signedPayment = function (string $dest) use ($owner, $now): string {
    $tx = (new TransactionBuilder(new Account($owner->getAccountId(), new BigInteger(100))))
        ->addOperation((new PaymentOperationBuilder($dest, Asset::native(), '1'))->build())
        ->setTimeBounds(new TimeBounds((new DateTime())->setTimestamp($now), (new DateTime())->setTimestamp($now + 3600)))
        ->build();
    $tx->sign($owner, Network::testnet());
    return $tx->toEnvelopeXdrBase64();
};

$apiDir = sys_get_temp_dir() . '/skm-nomemo-' . bin2hex(random_bytes(4));
$sideDir = sys_get_temp_dir() . '/skm-nomemo-side-' . bin2hex(random_bytes(4));
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
if (($_SERVER["REQUEST_METHOD"] ?? "") === "POST" && $path === "/transactions") { echo json_encode(["hash" => str_repeat("a", 64), "ledger" => 7]); return; }
if ($path === "/accounts/' . $memoDest . '") { echo json_encode(["id" => "' . $memoDest . '", "account_id" => "' . $memoDest . '", "sequence" => "1", "data" => ["config.memo_required" => "MQ=="]]); return; }
if ($path === "/accounts/' . $brokenDest . '") { http_response_code(500); echo "{}"; return; }
http_response_code(404); echo "{}";');
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => []]));
file_put_contents($apiDir . '/data/signers_cache_v2.json', json_encode([
    'testnet:' . $owner->getAccountId() => [
        'data' => ['ok' => true, 'signers' => [['publicKey' => $owner->getAccountId(), 'weight' => 1, 'type' => 'ed25519_public_key']],
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
$requests = fn() => file_exists($sideDir . '/requests.log') ? array_values(array_filter(explode("\n", (string)file_get_contents($sideDir . '/requests.log')))) : [];
$posts = fn() => count(array_filter($requests(), fn($l) => $l === 'POST /transactions'));
$accountLoads = fn() => count(array_filter($requests(), fn($l) => str_starts_with($l, 'GET /accounts/')));

try {
    check('sanity: Horizon-Stub und PHP-Server laufen', waitFor(STUB_PORT) && waitFor(TEST_PORT));
    foreach (['Ziel verlangt ein Memo' => $memoDest, 'Laden des Zielkontos wuerde scheitern' => $brokenDest] as $label => $dest) {
        $before = $posts();
        $res = request('POST', BASE_URL, ['network' => 'testnet', 'accountId' => $owner->getAccountId(), 'txXdr' => $signedPayment($dest)]);
        check("R-5: {$label}: gesendet, submitted_success (wie Node)", $res['status'] === 200 && ($res['body']['status'] ?? '') === 'submitted_success');
        check("R-5: {$label}: genau ein POST", $posts() === $before + 1);
    }
    check('R-5: keine Abfrage eines Zielkontos', $accountLoads() === 0);
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
