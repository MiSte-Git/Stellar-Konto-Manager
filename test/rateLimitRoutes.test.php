<?php
// R-8: Rate-Limits an den PHP-Routen (php -S gegen eine Kopie von api/). Je Route: das Budget
// aus test/assets/rate-limits.json greift, Status, Fehlercode und Retry-After stimmen.
// Federation (federation.php), Logo (trade.php), Job anlegen und Jobliste (multisig.php), Admin-Login mit
// Sperre und Freigabe (admin.php). Bugreport anlegen braucht vor dem Limit eine
// DB-Verbindung; dort prueft der Test die Einbindung im Quelltext, das Budget prueft
// test/rateLimitAreas.test.php. IPv6 je /64 laesst sich ueber Loopback nicht per HTTP
// pruefen, das macht ebenfalls test/rateLimitAreas.test.php.
//
// Run with: php test/rateLimitRoutes.test.php

declare(strict_types=1);

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

const TEST_PORT = 3973;
const BASE = 'http://127.0.0.1:' . TEST_PORT . '/api';
const GOOD_ORIGIN = 'http://localhost:5173';
const SECRET = 'rate-limit-test-secret';

function send(string $method, string $url, ?array $body = null, array $extraHeaders = []): array {
    $ch = curl_init($url);
    $headers = array_merge(['Origin: ' . GOOD_ORIGIN], $extraHeaders);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        $headers[] = 'Content-Type: application/json';
    }
    $retryAfter = null;
    $cacheControl = null;
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, string $line) use (&$retryAfter, &$cacheControl): int {
        if (stripos($line, 'Retry-After:') === 0) $retryAfter = (int)trim(substr($line, strlen('Retry-After:')));
        if (stripos($line, 'Cache-Control:') === 0) $cacheControl = trim(substr($line, strlen('Cache-Control:')));
        return strlen($line);
    });
    $raw = curl_exec($ch);
    return ['status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => json_decode((string)$raw, true) ?? [], 'retryAfter' => $retryAfter, 'cacheControl' => $cacheControl];
}

// 429 mit Fehlercode und Retry-After wie in der Fixture.
function isLimited(array $res, array $area): bool {
    $header = $res['retryAfter'];
    if ($res['status'] !== $area['status'] || ($res['body']['error'] ?? '') !== $area['error']) return false;
    if ($header === null || $header < 1 || $header > $area['windowSeconds']) return false;
    if ($area['retryAfterInBody']) return (int)($res['body']['retryAfter'] ?? 0) === $header;
    return !isset($res['body']['retryAfter']);
}

$limits = json_decode((string)file_get_contents(__DIR__ . '/assets/rate-limits.json'), true);

$apiDir = sys_get_temp_dir() . '/skm-ratelimit-routes-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($apiDir . '/sessions', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) {
    if (basename($file) !== '_config.php') copy($file, $apiDir . '/' . basename($file));
}
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
file_put_contents($apiDir . '/_config.php', "<?php\nreturn " . var_export(['BUGTRACKER_ADMIN_SECRET' => SECRET], true) . ";\n");
file_put_contents($apiDir . '/data/multisig_jobs.json', json_encode(['items' => []]));
file_put_contents($apiDir . '/router.php', <<<'PHP'
<?php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
if (preg_match('#^/api/admin($|/)#', $path)) { require __DIR__ . '/admin.php'; return true; }
if ($path === '/api/federation') { require __DIR__ . '/federation.php'; return true; }
if (preg_match('#^/api/trade($|/)#', $path)) { require __DIR__ . '/trade.php'; return true; }
if (preg_match('#^/api/multisig($|/)#', $path)) { require __DIR__ . '/multisig.php'; return true; }
http_response_code(404);
echo '{}';
return true;
PHP);
$attemptsFile = $apiDir . '/data/admin_login_attempts.json';

$server = proc_open(
    [PHP_BINARY, '-d', 'session.save_path=' . $apiDir . '/sessions', '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir,
    array_merge(getenv(), [
        'FEDERATION_RATE_LIMIT_PATH' => $apiDir . '/data/federation_rate_limit.json',
        'MULTISIG_JOB_RATE_LIMIT_PATH' => $apiDir . '/data/multisig_job_rate_limit.json',
        'MULTISIG_JOB_LIST_RATE_LIMIT_PATH' => $apiDir . '/data/multisig_job_list_rate_limit.json',
        'ADMIN_LOGIN_ATTEMPTS_PATH' => $attemptsFile,
        'ASSET_LOGO_RATE_LIMIT_PATH' => $apiDir . '/data/asset_logo_rate_limit.json',
    ])
);

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    // Federation: ohne type ergibt jede Anfrage 400 invalidInput, ohne Abruf nach aussen.
    $area = $limits['areas']['federation'];
    $within = true;
    for ($i = 0; $i < $area['max']; $i++) {
        if (send('GET', BASE . '/federation')['status'] !== 400) $within = false;
    }
    check("Federation: {$area['max']} Anfragen ohne 429", $within);
    check("Federation: die naechste -> 429 {$area['error']} mit Retry-After", isLimited(send('GET', BASE . '/federation'), $area));

    // Logo: ungueltiger Code ergibt 400 ohne Abruf nach aussen, gezaehlt wird vorher; 400 und 429 no-store.
    $area = $limits['areas']['assetLogo'];
    $logoUrl = BASE . '/trade/assets/logo?code=!!&issuer=GABC&network=testnet';
    // Review LP-2/LP-3/LP-6: Hop-Header, Sec-Fetch-Dest ausser image und andere Methoden werden vor dem Limiter
    // abgewiesen. Danach muss das volle Budget noch frei sein (Schleife unten).
    $refusedOk = true;
    for ($i = 0; $i < 3; $i++) {
        $hop = send('GET', $logoUrl, null, ['X-SKM-Logo-Hop: 1', 'Sec-Fetch-Dest: image']);
        $doc = send('GET', $logoUrl, null, ['Sec-Fetch-Dest: document']);
        $post = send('POST', $logoUrl, []);
        if ($hop['status'] !== 404 || ($hop['body']['error'] ?? '') !== 'assetLogo.hopRefused' || $hop['cacheControl'] !== 'no-store') $refusedOk = false;
        if ($doc['status'] !== 404 || ($doc['body']['error'] ?? '') !== 'assetLogo.notImageRequest' || $doc['cacheControl'] !== 'no-store') $refusedOk = false;
        if ($post['status'] !== 404 || ($post['body']['error'] ?? '') !== 'trade.notFound') $refusedOk = false;
    }
    check('Logo: Hop-Header 404 hopRefused, Dokument 404 notImageRequest (no-store), POST 404 trade.notFound', $refusedOk);
    check('Logo: Sec-Fetch-Dest image laeuft bis zur Pruefung (400)', send('GET', $logoUrl, null, ['Sec-Fetch-Dest: image'])['status'] === 400);
    $within = true;
    for ($i = 0; $i < $area['max'] - 1; $i++) {
        $res = send('GET', $logoUrl);
        if ($res['status'] !== 400 || ($res['body']['error'] ?? '') !== 'assetSearch.invalidInput:codeInvalid') $within = false;
    }
    check("Logo: {$area['max']} Anfragen ohne 429", $within);
    $res = send('GET', $logoUrl);
    check("Logo: die naechste -> 429 {$area['error']} mit retryAfter und Retry-After", isLimited($res, $area));
    check('Logo: 400 und 429 no-store', $res['cacheControl'] === 'no-store');

    // Job anlegen: leerer Body ergibt 400 invalid_network, gezaehlt wird vorher.
    $area = $limits['areas']['jobCreate'];
    $within = true;
    for ($i = 0; $i < $area['max']; $i++) {
        $res = send('POST', BASE . '/multisig/jobs', []);
        if ($res['status'] !== 400 || ($res['body']['error'] ?? '') !== 'invalid_network') $within = false;
    }
    check("Job anlegen: {$area['max']} Anfragen ohne 429", $within);
    check("Job anlegen: die naechste -> 429 {$area['error']} mit retryAfter und Retry-After", isLimited(send('POST', BASE . '/multisig/jobs', []), $area));

    // Jobliste: gezaehlt wird vor der Pruefung auf accountId oder signer.
    $area = $limits['areas']['jobList'];
    $within = true;
    for ($i = 0; $i < $area['max']; $i++) {
        $url = $i % 2 === 0 ? BASE . '/multisig/jobs' : BASE . '/multisig/jobs?network=testnet&accountId=GABC';
        $res = send('GET', $url);
        if ($res['status'] === 429) $within = false;
    }
    check("Jobliste: {$area['max']} Anfragen ohne 429", $within);
    check("Jobliste: die naechste -> 429 {$area['error']} mit retryAfter und Retry-After",
        isLimited(send('GET', BASE . '/multisig/jobs?network=testnet&accountId=GABC'), $area));
    check('Jobliste: Job anlegen hat ein eigenes Budget (eigene Datei)', file_exists($apiDir . '/data/multisig_job_list_rate_limit.json')
        && file_exists($apiDir . '/data/multisig_job_rate_limit.json'));

    // Admin-Login: nur Fehlversuche zaehlen, Erfolg loescht, Sperre ab maxFailures.
    $admin = $limits['adminLogin'];
    for ($i = 0; $i < $admin['maxFailures'] - 1; $i++) send('POST', BASE . '/admin/login', ['secret' => 'falsch']);
    $res = send('POST', BASE . '/admin/login', ['secret' => SECRET]);
    check('Admin-Login: richtiges Secret nach ' . ($admin['maxFailures'] - 1) . ' Fehlversuchen -> 200', $res['status'] === 200);
    check('Admin-Login: Erfolg loescht den Zaehler', (json_decode((string)@file_get_contents($attemptsFile), true) ?? []) === []);

    $statuses = [];
    for ($i = 0; $i < $admin['maxFailures']; $i++) $statuses[] = send('POST', BASE . '/admin/login', ['secret' => 'falsch'])['status'];
    check("Admin-Login: {$admin['maxFailures']} Fehlversuche -> je 401", $statuses === array_fill(0, $admin['maxFailures'], 401));
    check("Admin-Login: danach -> 429 {$admin['error']} mit retryAfter und Retry-After",
        isLimited(send('POST', BASE . '/admin/login', ['secret' => 'falsch']), $admin));
    check('Admin-Login: gesperrt auch mit richtigem Secret', isLimited(send('POST', BASE . '/admin/login', ['secret' => SECRET]), $admin));
    $entry = array_values(json_decode((string)file_get_contents($attemptsFile), true) ?? [])[0] ?? [];
    check('Admin-Login: Anfragen waehrend der Sperre zaehlen nicht', ($entry['count'] ?? 0) === $admin['maxFailures']);

    $data = json_decode((string)file_get_contents($attemptsFile), true);
    foreach ($data as $k => $e) {
        $data[$k]['lockedUntil'] = time() - 1;
        $data[$k]['firstAttempt'] = time() - $admin['windowSeconds'] - 1;
    }
    file_put_contents($attemptsFile, json_encode($data));
    check('Admin-Login: nach Ablauf der Sperre -> 200', send('POST', BASE . '/admin/login', ['secret' => SECRET])['status'] === 200);

    // Bugreport anlegen: Einbindung im Quelltext (vor dem Limit steht die DB-Verbindung).
    $src = (string)file_get_contents(__DIR__ . '/../api/bugreport.php');
    $area = $limits['areas']['bugreport'];
    check('Bugreport: Anlegen nutzt bugReportRateLimitCheckAndRecord mit Retry-After und 429 too_many_requests',
        preg_match("/bugReportRateLimitCheckAndRecord\\(\\\$ip\\);\\s*if \\(\\\$retryAfter > 0\\) \\{\\s*header\\('Retry-After: ' \\. \\\$retryAfter\\);\\s*json_out\\(\\['ok' => false, 'error' => '{$area['error']}', 'retryAfter' => \\\$retryAfter\\], 429\\);/", $src) === 1);
} finally {
    proc_terminate($server);
    proc_close($server);
    unlink($apiDir . '/vendor');
    foreach (glob($apiDir . '/{data,sessions}/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir . '/data');
    @rmdir($apiDir . '/sessions');
    @rmdir($apiDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
