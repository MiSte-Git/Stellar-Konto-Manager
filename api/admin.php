<?php
// api/admin.php
// Bugtracker admin session auth (finding A2): replaces the client-side secret
// comparison (VITE_BUGTRACKER_ADMIN_SECRET baked into the JS bundle) with a
// real server-side login that sets a PHP session cookie.
// Endpoints:
//   POST /api/admin/login   - { secret } -> sets session on success
//   GET  /api/admin/check   -> { authenticated: bool }
//   POST /api/admin/logout  -> destroys the session

declare(strict_types=1);

require __DIR__ . '/admin_session.php';
require __DIR__ . '/cors.php';
require __DIR__ . '/requestGuard.php';
require_once __DIR__ . '/rateLimit.php';

// CORS: session cookies require a specific origin (not '*') plus the
// credentials flag - shared allowlist in cors.php (finding #9).
apply_cors_headers(['GET', 'POST', 'OPTIONS'], ['Content-Type'], true);

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function json_out(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function json_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    // G5: kaputtes JSON ergibt 400 invalid_json, wie Node und api/bugreport.php.
    if (!is_array($data)) json_out(['ok' => false, 'error' => 'invalid_json'], 400);
    return $data;
}

// Brute-force protection for POST /api/admin/login (per-IP lockout, file-backed
// so it survives across requests without needing a DB). Not a replacement for
// the hash_equals() secret check - that remains the actual security boundary;
// this only slows down repeated guessing. Nur Fehlversuche zaehlen, nach 5 ist die IP
// 15 Minuten gesperrt, ein Erfolg loescht den Zaehler. Zaehlen, IP-Bildung (IPv6 je /64),
// Lock und Obergrenze der Eintraege liegen in api/rateLimit.php.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 900; // 15 minutes

function loginAttemptsPath(): string {
    return rateLimitPath('ADMIN_LOGIN_ATTEMPTS_PATH', 'admin_login_attempts.json');
}

function clientIp(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// Returns seconds remaining if the given IP is currently locked out, 0 otherwise.
function loginRateLimitCheck(string $ip): int {
    return rateLimitFailureCheck(loginAttemptsPath(), $ip);
}

// Records the outcome of a login attempt: clears the counter on success,
// increments (and locks past the threshold) on failure.
function loginRateLimitRecord(string $ip, bool $success): void {
    rateLimitFailureRecord(loginAttemptsPath(), $ip, $success, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS);
}

admin_session_start();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'POST' && $path === '/api/admin/login') {
    // G4: Origin und Content-Type vor dem Rate-Limit pruefen, damit ein
    // fremder Request keinen Login-Versuch verbraucht.
    require_allowed_origin();
    require_json_content_type();

    $ip = clientIp();
    $retryAfter = loginRateLimitCheck($ip);
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        json_out(['ok' => false, 'error' => 'too_many_attempts', 'retryAfter' => $retryAfter], 429);
    }

    $configPath = __DIR__ . '/_config.php';
    if (!file_exists($configPath)) {
        json_out(['ok' => false, 'error' => 'missing_config'], 500);
    }
    /** @noinspection PhpIncludeInspection */
    $cfg = require $configPath;
    $expected = (string)($cfg['BUGTRACKER_ADMIN_SECRET'] ?? '');
    $provided = (string)(json_body()['secret'] ?? '');
    $valid = $expected !== '' && $provided !== '' && hash_equals($expected, $provided);
    loginRateLimitRecord($ip, $valid);

    if (!$valid) {
        json_out(['ok' => false, 'error' => 'forbidden'], 401);
    }

    $_SESSION['bugtracker_admin'] = true;
    session_regenerate_id(true); // avoid session fixation across the login boundary
    json_out(['ok' => true]);
}

if ($method === 'GET' && $path === '/api/admin/check') {
    json_out(['authenticated' => is_admin_authenticated()]);
}

if ($method === 'POST' && $path === '/api/admin/logout') {
    // G4: kein Body, darum nur die Origin-Pruefung.
    require_allowed_origin();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?: '', $params['secure'], $params['httponly']);
    }
    session_destroy();
    json_out(['ok' => true]);
}

json_out(['ok' => false, 'error' => 'not_found'], 404);
