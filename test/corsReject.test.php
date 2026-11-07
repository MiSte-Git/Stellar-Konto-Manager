<?php
// G3: Fremde Origins werden in api/cors.php (apply_cors_headers) mit 403
// forbidden_origin abgewiesen, bevor ein Endpunkt etwas tut, auch beim
// Preflight. Requests ohne Origin-Header und von erlaubten Origins laufen wie
// bisher. Dazu die Normalisierung von PROD_ORIGIN (G4-2) und die Reihenfolge
// Origin vor Content-Type beim Bugreport-Update (G4-1).
// Prueft cors_normalize_origin()/cors_allowed_origins() direkt und den Ablauf
// per HTTP gegen eine Kopie von api/ (php -S, eigene _config.php, DB absichtlich
// unerreichbar). Pendant: test/corsReject.test.js (+ test/corsConfig.test.js).
//
// Run with: php test/corsReject.test.php

declare(strict_types=1);

require __DIR__ . '/../api/cors.php';

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

const TEST_PORT = 3929;
const ROOT = 'http://127.0.0.1:' . TEST_PORT;
const BASE = ROOT . '/api';
const SECRET = 'g3-test-secret';
const GOOD_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'https://evil.steei.de';
const PROD_ORIGIN_RAW = 'https://Admin.Example.Test/skm/';
const PROD_ORIGIN = 'https://admin.example.test';

// --- Normalisierung: gleiche Faelle wie NORMALIZE_CASES in test/corsConfig.test.js ---
$cases = [
    ['https://skm.steei.de', 'https://skm.steei.de'],
    ['https://skm.steei.de/', 'https://skm.steei.de'],
    ['https://skm.steei.de/pfad/unter?x=1#y', 'https://skm.steei.de'],
    ['HTTPS://SKM.Steei.DE', 'https://skm.steei.de'],
    ['  https://skm.steei.de  ', 'https://skm.steei.de'],
    ['https://skm.steei.de:443', 'https://skm.steei.de'],
    ['http://localhost:80/', 'http://localhost'],
    ['https://skm.steei.de:8443/', 'https://skm.steei.de:8443'],
    ['http://localhost:05173', 'http://localhost:5173'],
    ['http://[::1]:5173', 'http://[::1]:5173'],
    ['skm.steei.de', null],
    ['https:skm.steei.de', null],
    ['ftp://skm.steei.de', null],
    ['https://', null],
    ['https://user@skm.steei.de', null],
    ['https://exa mple.de', null],
    ['https://bücher.de', null],
    ['https://skm.steei.de:0', null],
    ['https://skm.steei.de:70000', null],
    ['https://skm.steei.de:', null],
    ['null', null],
    ['', null],
    // G3-1: nur ASCII-Trim; NBSP und BOM gehoeren nicht zur Origin (gleiche Faelle wie in Node).
    ["\t https://skm.steei.de \n\0\x0B", 'https://skm.steei.de'],
    ["\u{00A0}https://skm.steei.de", null],
    ["https://skm.steei.de\u{00A0}", null],
    ["\u{FEFF}https://skm.steei.de", null],
    ["https://skm.steei.de\u{2003}", null],
];
foreach ($cases as [$input, $expected]) {
    check('cors_normalize_origin(' . json_encode($input, JSON_UNESCAPED_UNICODE) . ') = ' . json_encode($expected), cors_normalize_origin($input) === $expected);
}

// --- Allowlist ------------------------------------------------------------------
putenv('PROD_ORIGIN');
check('Allowlist ohne PROD_ORIGIN: genau die drei festen Eintraege',
    cors_allowed_origins() === ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://skm.steei.de']);
foreach (['https://admin.example.test/', 'https://admin.example.test/skm/app', 'https://ADMIN.Example.Test', 'https://admin.example.test:443'] as $raw) {
    putenv('PROD_ORIGIN=' . $raw);
    check('PROD_ORIGIN ' . $raw . ' wird zu ' . PROD_ORIGIN . ' normalisiert', cors_origin_allowed(PROD_ORIGIN) && ($raw === PROD_ORIGIN || !cors_origin_allowed($raw)));
}
putenv('PROD_ORIGIN=https://skm.steei.de/');
check('PROD_ORIGIN gleich einem festen Eintrag erzeugt kein Duplikat', count(cors_allowed_origins()) === 3);

$logFile = tempnam(sys_get_temp_dir(), 'skm-g3-log-');
$previousLog = ini_set('error_log', $logFile);
putenv('PROD_ORIGIN=skm.example.test');
$list = cors_allowed_origins();
cors_allowed_origins();
ini_set('error_log', (string)$previousLog);
$logged = (string)file_get_contents($logFile);
unlink($logFile);
check('ungueltiges PROD_ORIGIN wird ignoriert', $list === ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://skm.steei.de']);
check('ungueltiges PROD_ORIGIN wird einmal (je Request) geloggt', substr_count($logged, 'PROD_ORIGIN') === 1);
putenv('PROD_ORIGIN=   ');
check('leeres PROD_ORIGIN wird still ignoriert', count(cors_allowed_origins()) === 3);
$prevLog2 = ini_set('error_log', '/dev/null');
foreach (["\u{00A0}https://admin.example.test", "\u{FEFF}https://admin.example.test", "https://admin.example.test\u{00A0}"] as $raw) {
    putenv('PROD_ORIGIN=' . $raw);
    check('G3-1: PROD_ORIGIN mit NBSP oder BOM wird ignoriert: ' . json_encode($raw), count(cors_allowed_origins()) === 3);
}
ini_set('error_log', (string)$prevLog2);
putenv('PROD_ORIGIN');

// --- HTTP gegen eine Kopie von api/ ------------------------------------------------
// $origin null = kein Origin-Header. $body ist roher Text.
function send(string $method, string $url, ?string $origin = GOOD_ORIGIN, ?string $body = null, ?string $contentType = null, ?string $cookie = null, array $extra = []): array {
    $ch = curl_init($url);
    $headers = $extra;
    // curl laesst "Origin: " ohne Wert weg; "Origin;" sendet den leeren Header.
    if ($origin !== null) $headers[] = $origin === '' ? 'Origin;' : 'Origin: ' . $origin;
    if ($cookie !== null) $headers[] = 'Cookie: ' . $cookie;
    if ($contentType !== null) $headers[] = 'Content-Type: ' . $contentType;
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $respHeaders = [];
    $setCookie = null;
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, string $line) use (&$respHeaders, &$setCookie): int {
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) $respHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
        if (stripos($line, 'Set-Cookie: skm_admin_session=') === 0 && stripos($line, 'deleted') === false) {
            $setCookie = trim(explode(';', substr($line, strlen('Set-Cookie: ')), 2)[0]);
        }
        return strlen($line);
    });
    $raw = curl_exec($ch);
    return [
        'status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'body' => json_decode((string)$raw, true) ?? [],
        'headers' => $respHeaders,
        'cookie' => $setCookie,
    ];
}

function is_forbidden_origin(array $res): bool {
    return $res['status'] === 403
        && $res['body'] === ['ok' => false, 'error' => 'forbidden_origin']
        && !isset($res['headers']['access-control-allow-origin'])
        && !isset($res['headers']['access-control-allow-credentials'])
        // G3-3: 403 nie cachen, Antwort haengt von Origin ab.
        && ($res['headers']['cache-control'] ?? '') === 'no-store'
        && ($res['headers']['vary'] ?? '') === 'Origin';
}

$apiDir = sys_get_temp_dir() . '/skm-g3-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($apiDir . '/sessions', 0775, true);
// Die echte _config.php (mit Zugangsdaten) wird nicht kopiert.
foreach (glob(__DIR__ . '/../api/*.php') as $file) {
    if (basename($file) !== '_config.php') copy($file, $apiDir . '/' . basename($file));
}
$vendor = realpath(__DIR__ . '/../api/vendor');
if ($vendor !== false) symlink($vendor, $apiDir . '/vendor');
file_put_contents($apiDir . '/_config.php', "<?php\nreturn " . var_export([
    'DB_DSN' => 'mysql:host=127.0.0.1;port=1;dbname=skm_test',
    'DB_USER' => 'skm_test',
    'DB_PASS' => '',
    'BUGTRACKER_ADMIN_SECRET' => SECRET,
], true) . ";\n");
// Router wie api/.htaccess.
file_put_contents($apiDir . '/router.php', <<<'PHP'
<?php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
if (preg_match('#^/api/admin($|/)#', $path)) { require __DIR__ . '/admin.php'; return true; }
if (preg_match('#^/api/multisig($|/)#', $path)) { require __DIR__ . '/multisig.php'; return true; }
if (preg_match('#^/api/trade($|/)#', $path)) { require __DIR__ . '/trade.php'; return true; }
if ($path === '/api/federation') { require __DIR__ . '/federation.php'; return true; }
if ($path === '/api/bugreport.php') { require __DIR__ . '/bugreport.php'; return true; }
if ($path === '/api/health.php') { require __DIR__ . '/health.php'; return true; }
http_response_code(404);
echo '{}';
return true;
PHP);

$dataFiles = function () use ($apiDir): array {
    return array_values(array_filter(glob($apiDir . '/data/{,.}*', GLOB_BRACE) ?: [], 'is_file'));
};
$sessionFiles = function () use ($apiDir): array {
    return array_values(array_filter(glob($apiDir . '/sessions/*') ?: [], 'is_file'));
};

$server = proc_open(
    [PHP_BINARY, '-d', 'session.save_path=' . $apiDir . '/sessions', '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir,
    array_merge(getenv(), [
        'BUGREPORT_RATE_LIMIT_PATH' => $apiDir . '/data/bugreport_rate_limit.json',
        'PROD_ORIGIN' => PROD_ORIGIN_RAW,
    ])
);

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);
    check('sanity: vendor/ fuer multisig.php vorhanden', $vendor !== false);

    // Fremde Origin, POST mit text/plain: kein Endpunkt tut etwas.
    $res = send('POST', BASE . '/bugreport.php', EVIL_ORIGIN, json_encode(['title' => 'CSRF', 'url' => 'https://evil.test']), 'text/plain');
    check('fremde Origin: Bugreport anlegen mit text/plain -> 403 forbidden_origin (vorher erreichte das die DB)', is_forbidden_origin($res));
    $res = send('POST', BASE . '/multisig/jobs/unbekannt/challenge', EVIL_ORIGIN, json_encode(['signer' => str_pad('G', 56, 'A')]), 'text/plain');
    check('fremde Origin: Multisig-Challenge mit text/plain -> 403 forbidden_origin', is_forbidden_origin($res));
    $res = send('POST', BASE . '/multisig/jobs', EVIL_ORIGIN, json_encode(['network' => 'testnet', 'accountId' => 'x', 'txXdr' => 'x']), 'text/plain');
    check('fremde Origin: Multisig-Job anlegen mit text/plain -> 403 forbidden_origin', is_forbidden_origin($res));
    $res = send('POST', BASE . '/admin/login', EVIL_ORIGIN, json_encode(['secret' => SECRET]), 'text/plain');
    check('fremde Origin: Admin-Login mit text/plain -> 403 forbidden_origin', is_forbidden_origin($res));
    $res = send('DELETE', BASE . '/multisig/jobs?network=testnet&confirm=DELETE%20TESTNET%20JOBS', EVIL_ORIGIN, null, null, null, ['x-admin-token: egal']);
    check('fremde Origin: DELETE /api/multisig/jobs -> 403 forbidden_origin', is_forbidden_origin($res));
    foreach ([BASE . '/trade/assets/search?code=!!', BASE . '/federation?type=name&q=x', BASE . '/health.php', BASE . '/admin/check', BASE . '/bugreport.php', BASE . '/multisig/jobs?network=testnet'] as $url) {
        check('fremde Origin: GET ' . substr($url, strlen(ROOT)) . ' -> 403 forbidden_origin', is_forbidden_origin(send('GET', $url, EVIL_ORIGIN)));
    }
    foreach (['null', '', 'https://skm.steei.de.evil.test', 'http://skm.steei.de', 'http://localhost:5174', 'https://skm.steei.de/'] as $origin) {
        check('fremde Origin ' . json_encode($origin) . ' -> 403', is_forbidden_origin(send('POST', BASE . '/bugreport.php', $origin, '{}', 'text/plain')));
    }
    check('keine Seiteneffekte: api/data bleibt nach abgewiesenen Requests leer', $dataFiles() === []);
    check('keine Seiteneffekte: keine Session fuer abgewiesene Requests angelegt', $sessionFiles() === []);

    // Fremde Origin beim Preflight.
    $preflight = ['Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: content-type'];
    foreach ([BASE . '/multisig/jobs', BASE . '/bugreport.php', BASE . '/admin/login', BASE . '/trade/assets/search', BASE . '/federation', BASE . '/health.php'] as $url) {
        check('fremde Origin: OPTIONS ' . substr($url, strlen(ROOT)) . ' -> 403', is_forbidden_origin(send('OPTIONS', $url, EVIL_ORIGIN, null, null, null, $preflight)));
    }

    // G4-1: fremde Origin plus text/plain beim Update -> 403; ohne Origin + text/plain jetzt auch 403 (Origin zuerst).
    $loginRes = send('POST', BASE . '/admin/login', GOOD_ORIGIN, json_encode(['secret' => SECRET]), 'application/json');
    check('sanity: Admin-Login von erlaubter Origin', $loginRes['status'] === 200 && $loginRes['cookie'] !== null);
    $update = json_encode(['action' => 'update', 'id' => 1, 'status' => 'closed']);
    check('G4-1: fremde Origin plus text/plain beim Update -> 403 forbidden_origin',
        is_forbidden_origin(send('POST', BASE . '/bugreport.php', EVIL_ORIGIN, $update, 'text/plain', $loginRes['cookie'])));
    $res = send('POST', BASE . '/bugreport.php', null, $update, 'text/plain', $loginRes['cookie']);
    check('G4-1: ohne Origin plus text/plain beim Update -> 403 forbidden_origin (Origin vor Content-Type, wie Node)',
        $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');

    // Erlaubte Origin: unveraendert, inkl. CORS-Header und Credentials, wo bisher gesetzt.
    $res = send('OPTIONS', BASE . '/bugreport.php', GOOD_ORIGIN, null, null, null, $preflight);
    check('erlaubte Origin: OPTIONS bugreport -> 204 mit Origin und Credentials', $res['status'] === 204
        && ($res['headers']['access-control-allow-origin'] ?? '') === GOOD_ORIGIN
        && ($res['headers']['access-control-allow-credentials'] ?? '') === 'true');
    $res = send('OPTIONS', BASE . '/admin/login', GOOD_ORIGIN, null, null, null, $preflight);
    check('erlaubte Origin: OPTIONS admin -> 204 mit Origin und Credentials', $res['status'] === 204
        && ($res['headers']['access-control-allow-credentials'] ?? '') === 'true');
    $res = send('OPTIONS', BASE . '/multisig/jobs', GOOD_ORIGIN, null, null, null, $preflight);
    check('erlaubte Origin: OPTIONS multisig -> 200 mit Origin, ohne Credentials, DELETE und x-job-token erlaubt', $res['status'] === 200
        && ($res['headers']['access-control-allow-origin'] ?? '') === GOOD_ORIGIN
        && !isset($res['headers']['access-control-allow-credentials'])
        && strpos($res['headers']['access-control-allow-methods'] ?? '', 'DELETE') !== false
        && strpos($res['headers']['access-control-allow-headers'] ?? '', 'x-job-token') !== false);
    $res = send('OPTIONS', BASE . '/trade/assets/search', GOOD_ORIGIN, null, null, null, $preflight);
    check('erlaubte Origin: OPTIONS trade -> 204 mit Origin', $res['status'] === 204 && ($res['headers']['access-control-allow-origin'] ?? '') === GOOD_ORIGIN);
    $res = send('GET', BASE . '/trade/assets/search?code=!!', GOOD_ORIGIN);
    check('erlaubte Origin: Trade-Handler laeuft (400 wegen ungueltigem Code) mit Origin-Header', $res['status'] === 400 && ($res['headers']['access-control-allow-origin'] ?? '') === GOOD_ORIGIN);
    $res = send('POST', BASE . '/multisig/jobs/unbekannt/challenge', GOOD_ORIGIN, json_encode(['signer' => str_pad('G', 56, 'A')]), 'application/json');
    check('erlaubte Origin: Multisig-Challenge erreicht den Handler (404 not_found)', $res['status'] === 404);
    $res = send('POST', BASE . '/bugreport.php', GOOD_ORIGIN, json_encode(['title' => 'Ok', 'url' => 'https://example.test/ok']), 'application/json');
    check('erlaubte Origin: Bugreport anlegen erreicht die DB (500) mit Origin und Credentials', $res['status'] === 500
        && ($res['body']['error'] ?? '') === 'server_error'
        && ($res['headers']['access-control-allow-origin'] ?? '') === GOOD_ORIGIN
        && ($res['headers']['access-control-allow-credentials'] ?? '') === 'true');

    // Ohne Origin-Header: unveraendert.
    $res = send('POST', BASE . '/bugreport.php', null, json_encode(['title' => 'Skript', 'url' => 'https://example.test/s']), 'application/json');
    check('ohne Origin: Bugreport anlegen erreicht die DB (500), kein CORS-Origin-Header', $res['status'] === 500 && !isset($res['headers']['access-control-allow-origin']));
    $res = send('GET', BASE . '/admin/check', null);
    check('ohne Origin: Admin-Check -> 200', $res['status'] === 200 && ($res['body']['authenticated'] ?? null) === false);
    $res = send('GET', BASE . '/health.php', null);
    check('ohne Origin: Health erreicht die DB (500 wie bisher bei unerreichbarer DB)', $res['status'] === 500 && ($res['body']['db'] ?? null) === false);
    $res = send('GET', BASE . '/trade/assets/search?code=!!', null);
    check('ohne Origin: Trade-Handler laeuft (400)', $res['status'] === 400);

    // PROD_ORIGIN wird normalisiert, https://skm.steei.de ist fest erlaubt.
    $res = send('OPTIONS', BASE . '/bugreport.php', PROD_ORIGIN);
    check('PROD_ORIGIN mit Grossbuchstaben, Pfad und Slash passt normalisiert', $res['status'] === 204 && ($res['headers']['access-control-allow-origin'] ?? '') === PROD_ORIGIN);
    check('der rohe PROD_ORIGIN-Wert ist keine Browser-Origin und passt nicht', is_forbidden_origin(send('OPTIONS', BASE . '/bugreport.php', PROD_ORIGIN_RAW)));
    $res = send('OPTIONS', BASE . '/bugreport.php', 'https://skm.steei.de');
    // G3-3: Vary: Origin auf erlaubten Antworten und auf Antworten ohne Origin-Header.
    check('G3-3: Vary: Origin bei erlaubter Origin', ($res['headers']['vary'] ?? '') === 'Origin');
    $res = send('GET', BASE . '/admin/check', null);
    check('G3-3: Vary: Origin auch ohne Origin-Header, ohne Allow-Origin', ($res['headers']['vary'] ?? '') === 'Origin' && !isset($res['headers']['access-control-allow-origin']));
    $res = send('OPTIONS', BASE . '/bugreport.php', 'https://skm.steei.de');
    check('https://skm.steei.de ist erlaubt', $res['status'] === 204 && ($res['headers']['access-control-allow-origin'] ?? '') === 'https://skm.steei.de');
} finally {
    proc_terminate($server);
    proc_close($server);
    foreach (['data', 'sessions'] as $sub) {
        foreach (glob($apiDir . '/' . $sub . '/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
        @rmdir($apiDir . '/' . $sub);
    }
    if (is_link($apiDir . '/vendor')) unlink($apiDir . '/vendor');
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
