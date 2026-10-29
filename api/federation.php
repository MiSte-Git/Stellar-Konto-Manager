<?php
// GET /api/federation?type=name&q=name*domain       -> forward (SEP-2)
// GET /api/federation?type=id&q=G...&network=PUBLIC -> reverse lookup
// PHP twin of the /api/federation route in server.js; all rules live in
// api/federationService.php (Backlog P1.2: keeps the frontend CSP's
// connect-src free of arbitrary domains).
declare(strict_types=1);

require __DIR__ . '/cors.php';
require __DIR__ . '/federationService.php';
require_once __DIR__ . '/stellarNetworks.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

apply_cors_headers(['GET', 'OPTIONS'], ['Content-Type']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

// Loop guard: a request from a federation backend (ours) is refused before
// it costs rate-limit budget or outbound requests.
if (!empty($_SERVER['HTTP_X_SKM_FEDERATION_HOP'])) {
    $result = federation_handle_request([], fn() => '', null, true);
    http_response_code($result['status']);
    echo json_encode($result['body']);
    exit;
}

$retryAfter = federation_rate_limit_check_and_record((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
if ($retryAfter > 0) {
    header('Retry-After: ' . $retryAfter);
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'federation.rateLimited']);
    exit;
}

$horizonBase = skm_horizon_url(skm_network_from_query($_GET['network'] ?? null));

$result = federation_handle_request($_GET, function (string $accountId) use ($horizonBase): string {
    $account = fetch_json($horizonBase . '/accounts/' . rawurlencode($accountId));
    return is_string($account['home_domain'] ?? null) ? $account['home_domain'] : '';
});

http_response_code($result['status']);
echo json_encode($result['body']);
