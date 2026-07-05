<?php
// Shared CORS origin allowlist for all api/*.php endpoints (finding #9) -
// single source of truth so the allowlist can't drift between files (it
// previously had, silently: trade.php was missing skm.steei.de/PROD_ORIGIN
// that admin.php/bugreport.php/multisig.php already had).
declare(strict_types=1);

function cors_allowed_origins(): array {
    $origins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://skm.steei.de',
    ];
    $prodOrigin = getenv('PROD_ORIGIN');
    if ($prodOrigin) $origins[] = $prodOrigin;
    return $origins;
}

/**
 * Sets Access-Control-Allow-Origin (+ Vary, and Credentials if requested)
 * when the request's Origin header is on the allowlist, plus the given
 * Methods/Headers. Does NOT handle the OPTIONS preflight short-circuit -
 * callers keep doing that themselves, since their exact status codes/exit
 * points differ (204 vs 200) and changing that is out of scope here.
 */
function apply_cors_headers(array $allowedMethods, array $allowedHeaders, bool $withCredentials = false): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, cors_allowed_origins(), true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        if ($withCredentials) header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: ' . implode(', ', $allowedMethods));
    header('Access-Control-Allow-Headers: ' . implode(', ', $allowedHeaders));
}
