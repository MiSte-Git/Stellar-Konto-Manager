<?php
// G5: Kaputtes JSON ergibt 400 invalid_json ohne Inhalt des Bodys (api/multisig.php und
// api/admin.php; api/bugreport.php tat das schon). Vorher lasen multisig.php und admin.php
// kaputtes JSON still als leeren Body. Echter HTTP-Test gegen eine Kopie von api/ (php -S).
// Pendant: test/invalidJson.test.js.
//
// Run with: php test/invalidJson.test.php

declare(strict_types=1);

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) { $passed++; echo "\xE2\x9C\x94 {$description}\n"; }
    else { $failed++; echo "\xE2\x9C\x98 {$description}\n"; }
}

const TEST_PORT = 3935;
const BASE = 'http://127.0.0.1:' . TEST_PORT . '/api';
const ORIGIN = 'http://localhost:5173';
const MARKER = 'GEHEIMER-BODY-INHALT';

function post(string $url, string $body): array {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'Origin: ' . ORIGIN]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $raw = (string)curl_exec($ch);
    return ['status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'text' => $raw, 'body' => json_decode($raw, true) ?? []];
}

$apiDir = sys_get_temp_dir() . '/skm-json-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($apiDir . '/sessions', 0775, true);
foreach (glob(__DIR__ . '/../api/*.php') as $file) {
    if (basename($file) !== '_config.php') copy($file, $apiDir . '/' . basename($file));
}
symlink(realpath(__DIR__ . '/../api/vendor'), $apiDir . '/vendor');
file_put_contents($apiDir . '/_config.php', "<?php\nreturn " . var_export([
    'DB_DSN' => 'mysql:host=127.0.0.1;port=1;dbname=skm_test',
    'DB_USER' => 'skm_test',
    'DB_PASS' => '',
    'BUGTRACKER_ADMIN_SECRET' => 'json-test-secret',
], true) . ";\n");
file_put_contents($apiDir . '/router.php', <<<'PHP'
<?php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
if (preg_match('#^/api/admin($|/)#', $path)) { require __DIR__ . '/admin.php'; return true; }
if (preg_match('#^/api/multisig($|/)#', $path)) { require __DIR__ . '/multisig.php'; return true; }
http_response_code(404);
echo '{}';
PHP);

$server = proc_open(
    [PHP_BINARY, '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir
);

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    foreach ([BASE . '/multisig/jobs', BASE . '/admin/login'] as $url) {
        foreach (['{"x": "' . MARKER . '"', '{"x": ' . MARKER . '}', 'nur text', '"skalar"', '42'] as $body) {
            $res = post($url, $body);
            check("{$url}: kaputtes JSON {$body} -> 400 invalid_json", $res['status'] === 400 && $res['body'] === ['ok' => false, 'error' => 'invalid_json']);
            check("{$url}: Antwort enthaelt den Body-Inhalt nicht", strpos($res['text'], MARKER) === false);
        }
    }
    $res = post(BASE . '/multisig/jobs', '');
    check('leerer Body laeuft weiter wie bisher (invalid_network)', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_network');
    $res = post(BASE . '/multisig/jobs', '{}');
    check('gueltiges JSON laeuft weiter wie bisher (invalid_network)', $res['status'] === 400 && ($res['body']['error'] ?? '') === 'invalid_network');
} finally {
    proc_terminate($server);
    proc_close($server);
    @unlink($apiDir . '/vendor');
    foreach (['data', 'sessions'] as $sub) {
        foreach (glob($apiDir . '/' . $sub . '/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
        @rmdir($apiDir . '/' . $sub);
    }
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
