<?php
// G4: Aendernde Admin-Requests (Login, Logout, Bugreport-Update) nur von einer
// erlaubten Origin und, wenn sie einen Body haben, nur als application/json (PHP).
// Prueft die Helfer in api/requestGuard.php direkt und den Ablauf per HTTP gegen
// api/admin.php und api/bugreport.php (php -S, Kopie von api/ mit eigener
// _config.php). Pendant: test/adminRequestGuard.test.js.
//
// Ohne MySQL im Test zeigt das Bugreport-Update den Durchlauf durch die
// Pruefungen so: abgewiesene Requests enden vor der DB-Verbindung mit 403/415,
// ein zugelassener Request erreicht die (absichtlich unerreichbare) DB und
// endet mit 500 server_error. Dass die DB gar nicht beruehrt wird, ist hier der
// Nachweis fuer "keine Aenderung".
//
// Run with: php test/adminRequestGuard.test.php

declare(strict_types=1);

require __DIR__ . '/../api/requestGuard.php';

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

const TEST_PORT = 3926;
const BASE = 'http://127.0.0.1:' . TEST_PORT . '/api';
const SECRET = 'g4-test-secret';
const GOOD_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'https://evil.steei.de';

// --- Helfer -----------------------------------------------------------------
check('request_origin_allowed: localhost:5173 erlaubt', request_origin_allowed('http://localhost:5173'));
check('request_origin_allowed: 127.0.0.1:5173 erlaubt', request_origin_allowed('http://127.0.0.1:5173'));
check('request_origin_allowed: skm.steei.de erlaubt', request_origin_allowed('https://skm.steei.de'));
check('request_origin_allowed: andere Subdomain abgelehnt', !request_origin_allowed(EVIL_ORIGIN));
check('request_origin_allowed: Schraegstrich am Ende abgelehnt (exakter Vergleich)', !request_origin_allowed('http://localhost:5173/'));
check('request_origin_allowed: anderer Port abgelehnt', !request_origin_allowed('http://localhost:51730'));
check('request_origin_allowed: "null" abgelehnt', !request_origin_allowed('null'));
check('request_origin_allowed: leer und fehlend abgelehnt', !request_origin_allowed('') && !request_origin_allowed(null));

check('is_json_content_type: application/json', is_json_content_type('application/json'));
check('is_json_content_type: mit charset', is_json_content_type('application/json; charset=utf-8'));
check('is_json_content_type: Gross-/Kleinschreibung egal', is_json_content_type('Application/JSON;charset=UTF-8'));
check('is_json_content_type: Leerzeichen drumherum', is_json_content_type(' application/json '));
check('is_json_content_type: text/plain abgelehnt', !is_json_content_type('text/plain'));
check('is_json_content_type: application/json nur als Parameter abgelehnt', !is_json_content_type('text/plain; charset=application/json'));
check('is_json_content_type: Formular-Typen abgelehnt', !is_json_content_type('application/x-www-form-urlencoded') && !is_json_content_type('multipart/form-data; boundary=x'));
check('is_json_content_type: application/jsonp abgelehnt', !is_json_content_type('application/jsonp'));
check('is_json_content_type: leer und fehlend abgelehnt', !is_json_content_type('') && !is_json_content_type(null));

// --- HTTP gegen admin.php und bugreport.php ------------------------------------
// $origin null = kein Origin-Header, $contentType null = kein Content-Type-Header.
function send(string $method, string $url, ?string $origin = GOOD_ORIGIN, ?array $body = null, ?string $contentType = 'application/json', ?string $cookie = null): array {
    $ch = curl_init($url);
    $headers = [];
    if ($origin !== null) $headers[] = 'Origin: ' . $origin;
    if ($cookie !== null) $headers[] = 'Cookie: ' . $cookie;
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        $headers[] = 'Content-Type: ' . ($contentType ?? '');
    }
    $setCookie = null;
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, string $line) use (&$setCookie): int {
        if (stripos($line, 'Set-Cookie: skm_admin_session=') === 0 && stripos($line, 'deleted') === false) {
            $setCookie = trim(explode(';', substr($line, strlen('Set-Cookie: ')), 2)[0]);
        }
        return strlen($line);
    });
    $raw = curl_exec($ch);
    return ['status' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => json_decode((string)$raw, true) ?? [], 'cookie' => $setCookie];
}

$apiDir = sys_get_temp_dir() . '/skm-g4-' . bin2hex(random_bytes(4));
mkdir($apiDir . '/data', 0775, true);
mkdir($apiDir . '/sessions', 0775, true);
// Die echte _config.php (mit Zugangsdaten) wird nicht kopiert.
foreach (glob(__DIR__ . '/../api/*.php') as $file) {
    if (basename($file) !== '_config.php') copy($file, $apiDir . '/' . basename($file));
}
// DB absichtlich unerreichbar (Port 1): ein Request, der die DB erreicht, endet mit 500.
file_put_contents($apiDir . '/_config.php', "<?php\nreturn " . var_export([
    'DB_DSN' => 'mysql:host=127.0.0.1;port=1;dbname=skm_test',
    'DB_USER' => 'skm_test',
    'DB_PASS' => '',
    'BUGTRACKER_ADMIN_SECRET' => SECRET,
], true) . ";\n");
// Router wie api/.htaccess: /api/admin/... -> admin.php, /api/bugreport.php direkt.
file_put_contents($apiDir . '/router.php', <<<'PHP'
<?php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
if (preg_match('#^/api/admin($|/)#', $path)) { require __DIR__ . '/admin.php'; return true; }
if ($path === '/api/bugreport.php') { require __DIR__ . '/bugreport.php'; return true; }
http_response_code(404);
echo '{}';
return true;
PHP);
$attemptsFile = $apiDir . '/data/admin_login_attempts.json';
$attemptsFor = function () use ($attemptsFile): ?array {
    if (!file_exists($attemptsFile)) return null;
    $data = json_decode((string)file_get_contents($attemptsFile), true);
    return is_array($data) ? $data : null;
};

$server = proc_open(
    [PHP_BINARY, '-d', 'session.save_path=' . $apiDir . '/sessions', '-S', '127.0.0.1:' . TEST_PORT, $apiDir . '/router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes,
    $apiDir,
    array_merge(getenv(), ['BUGREPORT_RATE_LIMIT_PATH' => $apiDir . '/data/bugreport_rate_limit.json'])
);

try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $socket = @fsockopen('127.0.0.1', TEST_PORT);
        if ($socket) { fclose($socket); $ready = true; } else { usleep(100000); }
    }
    check('sanity: PHP-Server laeuft', $ready);

    $isAuthenticated = fn(?string $cookie): bool => (bool)(send('GET', BASE . '/admin/check', GOOD_ORIGIN, null, null, $cookie)['body']['authenticated'] ?? false);
    $login = function (): ?string {
        $res = send('POST', BASE . '/admin/login', GOOD_ORIGIN, ['secret' => SECRET]);
        return $res['status'] === 200 ? $res['cookie'] : null;
    };

    // Login
    $res = send('POST', BASE . '/admin/login', EVIL_ORIGIN, ['secret' => 'falsch']);
    check('Login: fremde Origin -> 403 forbidden_origin', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    // admin_session_start() laeuft vor dem Routing und legt fuer jeden neuen
    // Besucher eine leere Session an (wie bisher). Entscheidend ist, dass sie
    // nicht angemeldet ist.
    $res = send('POST', BASE . '/admin/login', EVIL_ORIGIN, ['secret' => SECRET]);
    check('Login: fremde Origin mit richtigem Secret -> 403, Session nicht angemeldet', $res['status'] === 403 && !$isAuthenticated($res['cookie']));
    $res = send('POST', BASE . '/admin/login', null, ['secret' => 'falsch']);
    check('Login: fehlende Origin -> 403 forbidden_origin', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    $res = send('POST', BASE . '/admin/login', GOOD_ORIGIN, ['secret' => SECRET], 'text/plain');
    check('Login: text/plain mit gueltigem JSON -> 415 unsupported_media_type, Session nicht angemeldet', $res['status'] === 415 && ($res['body']['error'] ?? '') === 'unsupported_media_type' && !$isAuthenticated($res['cookie']));
    $res = send('POST', BASE . '/admin/login', GOOD_ORIGIN, ['secret' => 'falsch'], 'text/plain');
    check('Login: text/plain mit falschem Secret -> 415', $res['status'] === 415);
    check('Login: abgewiesene Requests verbrauchen keinen Versuch im Rate-Limit', $attemptsFor() === null || $attemptsFor() === []);

    $res = send('POST', BASE . '/admin/login', GOOD_ORIGIN, ['secret' => 'falsch']);
    check('Login: falsches Secret von erlaubter Origin bleibt 401', $res['status'] === 401);
    $entry = array_values($attemptsFor() ?? [])[0] ?? [];
    check('Sanity: ein echter Fehlversuch zaehlt genau einmal im Rate-Limit', count($attemptsFor() ?? []) === 1 && (int)($entry['count'] ?? 0) === 1);

    $res = send('POST', BASE . '/admin/login', GOOD_ORIGIN, ['secret' => SECRET], 'application/json; charset=utf-8');
    check('Login: erlaubte Origin und JSON (mit charset) -> 200 mit Session', $res['status'] === 200 && ($res['body']['ok'] ?? false) === true && $res['cookie'] !== null);
    check('Login: Session ist angemeldet', $isAuthenticated($res['cookie']));

    // Bugreport-Update
    $cookie = $login();
    check('sanity: Admin-Login fuer Update-Tests', $cookie !== null);
    $update = ['action' => 'update', 'id' => 1, 'status' => 'closed', 'contactEmail' => 'evil@example.test'];
    $res = send('POST', BASE . '/bugreport.php', EVIL_ORIGIN, $update, 'application/json', $cookie);
    check('Update: fremde Origin -> 403 forbidden_origin, DB nicht beruehrt', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    $res = send('POST', BASE . '/bugreport.php', null, $update, 'application/json', $cookie);
    check('Update: fehlende Origin -> 403 forbidden_origin, DB nicht beruehrt', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    $res = send('POST', BASE . '/bugreport.php', GOOD_ORIGIN, $update, 'text/plain', $cookie);
    check('Update: text/plain mit gueltigem JSON -> 415, DB nicht beruehrt', $res['status'] === 415 && ($res['body']['error'] ?? '') === 'unsupported_media_type');
    $res = send('POST', BASE . '/bugreport.php', EVIL_ORIGIN, $update, 'application/json');
    check('Update: fremde Origin ohne Session -> 403 forbidden_origin vor require_admin', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    $res = send('POST', BASE . '/bugreport.php', GOOD_ORIGIN, $update, 'application/json');
    check('Update: erlaubte Origin und JSON ohne Session -> 403 forbidden (require_admin greift weiter)', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden');
    $res = send('POST', BASE . '/bugreport.php', GOOD_ORIGIN, $update, 'application/json; charset=utf-8', $cookie);
    check('Update: erlaubte Origin, JSON und Session passieren alle Pruefungen (erreichen die Test-DB -> 500)', $res['status'] === 500 && ($res['body']['error'] ?? '') === 'server_error');

    // Logout
    $cookie = $login();
    $res = send('POST', BASE . '/admin/logout', EVIL_ORIGIN, null, null, $cookie);
    check('Logout: fremde Origin -> 403 forbidden_origin', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    $res = send('POST', BASE . '/admin/logout', null, null, null, $cookie);
    check('Logout: fehlende Origin -> 403 forbidden_origin', $res['status'] === 403 && ($res['body']['error'] ?? '') === 'forbidden_origin');
    check('Logout: Session bleibt nach abgewiesenem Logout bestehen', $isAuthenticated($cookie));
    $res = send('POST', BASE . '/admin/logout', GOOD_ORIGIN, null, null, $cookie);
    check('Logout: erlaubte Origin ohne Body -> 200', $res['status'] === 200 && ($res['body']['ok'] ?? false) === true);
    check('Logout: Session ist danach abgemeldet', !$isAuthenticated($cookie));

    // Oeffentliches Anlegen: keine Origin-/Content-Type-Pruefung, erreicht wie bisher die DB.
    $create = ['title' => 'Neu', 'url' => 'https://example.test/neu'];
    $res = send('POST', BASE . '/bugreport.php', null, $create, 'application/json');
    check('Anlegen ohne Origin wird nicht abgewiesen (erreicht die Test-DB -> 500)', $res['status'] === 500 && ($res['body']['error'] ?? '') === 'server_error');
    $res = send('POST', BASE . '/bugreport.php', EVIL_ORIGIN, $create, 'text/plain');
    check('Anlegen mit fremder Origin und text/plain bleibt unveraendert (erreicht die Test-DB -> 500)', $res['status'] === 500 && ($res['body']['error'] ?? '') === 'server_error');
} finally {
    proc_terminate($server);
    proc_close($server);
    foreach (['data', 'sessions'] as $sub) {
        foreach (glob($apiDir . '/' . $sub . '/{,.}*', GLOB_BRACE) as $file) { if (is_file($file)) unlink($file); }
        @rmdir($apiDir . '/' . $sub);
    }
    foreach (glob($apiDir . '/*.php') as $file) unlink($file);
    @rmdir($apiDir);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
