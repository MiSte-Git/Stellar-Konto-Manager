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

// CORS: session cookies require a specific origin (not '*') plus the
// credentials flag, matching the allowlist already used in bugreport.php.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://skm.steei.de',
];
$prodOrigin = getenv('PROD_ORIGIN');
if ($prodOrigin) $allowedOrigins[] = $prodOrigin;
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

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
    return is_array($data) ? $data : [];
}

// Brute-force protection for POST /api/admin/login (per-IP lockout, file-backed
// so it survives across requests without needing a DB). Not a replacement for
// the hash_equals() secret check - that remains the actual security boundary;
// this only slows down repeated guessing.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 900; // 15 minutes

function loginAttemptsPath(): string {
    return __DIR__ . '/data/admin_login_attempts.json';
}

function clientIp(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// Returns seconds remaining if the given IP is currently locked out, 0 otherwise.
function loginRateLimitCheck(string $ip): int {
    $file = loginAttemptsPath();
    if (!file_exists($file)) return 0;
    $raw = @file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data) || !isset($data[$ip])) return 0;
    $lockedUntil = (int)($data[$ip]['lockedUntil'] ?? 0);
    $remaining = $lockedUntil - time();
    return $remaining > 0 ? $remaining : 0;
}

// Records the outcome of a login attempt: clears the counter on success,
// increments (and locks past the threshold) on failure.
function loginRateLimitRecord(string $ip, bool $success): void {
    $file = loginAttemptsPath();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) return; // fail open on the rate limiter itself
    flock($lockHandle, LOCK_EX);
    try {
        $data = [];
        if (file_exists($file)) {
            $raw = @file_get_contents($file);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) $data = $decoded;
        }

        $now = time();
        // Prune entries that are neither locked nor within their counting window,
        // so the file doesn't grow forever.
        foreach ($data as $key => $entry) {
            $lockedUntil = (int)($entry['lockedUntil'] ?? 0);
            $firstAttempt = (int)($entry['firstAttempt'] ?? 0);
            if ($lockedUntil <= $now && ($now - $firstAttempt) > LOGIN_WINDOW_SECONDS) {
                unset($data[$key]);
            }
        }

        if ($success) {
            unset($data[$ip]);
        } else {
            $entry = $data[$ip] ?? ['count' => 0, 'firstAttempt' => $now, 'lockedUntil' => 0];
            if (($now - (int)$entry['firstAttempt']) > LOGIN_WINDOW_SECONDS) {
                $entry = ['count' => 0, 'firstAttempt' => $now, 'lockedUntil' => 0];
            }
            $entry['count'] = (int)$entry['count'] + 1;
            if ($entry['count'] >= LOGIN_MAX_ATTEMPTS) {
                $entry['lockedUntil'] = $now + LOGIN_WINDOW_SECONDS;
            }
            $data[$ip] = $entry;
        }

        @file_put_contents($file, json_encode($data));
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

admin_session_start();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'POST' && $path === '/api/admin/login') {
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
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?: '', $params['secure'], $params['httponly']);
    }
    session_destroy();
    json_out(['ok' => true]);
}

json_out(['ok' => false, 'error' => 'not_found'], 404);
