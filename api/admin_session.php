<?php
// Shared PHP-session helper for the bugtracker admin auth (finding A2).
// Included by admin.php (login/check/logout) and bugreport.php (protected endpoints)
// so both always start the exact same session (same name/cookie flags).
declare(strict_types=1);

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
}

function is_admin_authenticated(): bool {
    return !empty($_SESSION['bugtracker_admin']);
}
