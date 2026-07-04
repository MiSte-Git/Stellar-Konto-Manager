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

admin_session_start();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'POST' && $path === '/api/admin/login') {
    $configPath = __DIR__ . '/_config.php';
    if (!file_exists($configPath)) {
        json_out(['ok' => false, 'error' => 'missing_config'], 500);
    }
    /** @noinspection PhpIncludeInspection */
    $cfg = require $configPath;
    $expected = (string)($cfg['BUGTRACKER_ADMIN_SECRET'] ?? '');
    $provided = (string)(json_body()['secret'] ?? '');

    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
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
