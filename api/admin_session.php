<?php
// Shared PHP-session helper for the bugtracker admin auth (finding A2).
// Included by admin.php (login/check/logout) and bugreport.php (protected endpoints)
// so both always start the exact same session (same name/cookie flags).
declare(strict_types=1);

// Explicit inactivity timeout (finding #13): session.gc_maxlifetime is
// shared-hosting php.ini config this app doesn't control, and PHP's garbage
// collector only runs probabilistically - neither reliably expires an idle
// session on its own. This enforces the timeout at the application level
// instead, the same way regardless of hosting defaults.
const ADMIN_SESSION_IDLE_TIMEOUT_SECONDS = 1800; // 30 minutes

function admin_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');
    session_set_cookie_params([
        'lifetime' => 0, // session cookie, ends when the browser closes
        'path' => '/',
        'httponly' => true,
        'secure' => $isHttps,
        'samesite' => 'Lax',
    ]);
    session_name('skm_admin_session');
    session_start();

    $now = time();
    $lastActivity = (int)($_SESSION['bugtracker_last_activity'] ?? 0);
    if ($lastActivity > 0 && ($now - $lastActivity) > ADMIN_SESSION_IDLE_TIMEOUT_SECONDS) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['bugtracker_last_activity'] = $now;
}

function is_admin_authenticated(): bool {
    return !empty($_SESSION['bugtracker_admin']);
}
