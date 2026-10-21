<?php
// Security headers for all api/*.php JSON responses (Backlog P1.2).
// PHP twin of apiHeaders()/createApiSecurityHeadersMiddleware() in
// services/securityHeaders.js - test/securityHeaders.test.js checks that the
// values below stay identical to the Node backend's.
//
// JSON needs no full CSP: nothing renders, nothing may frame it. The
// frontend's HTML headers (full CSP, Permissions-Policy, X-Frame-Options)
// come from the frontend .htaccess, which excludes /api. HSTS is set there
// for api/ as well, so it is not repeated here.
declare(strict_types=1);

const SKM_API_CSP = "default-src 'none'; frame-ancestors 'none'";
const SKM_API_REFERRER_POLICY = 'strict-origin-when-cross-origin';

function api_security_headers(): array {
    return [
        'Content-Security-Policy' => SKM_API_CSP,
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => SKM_API_REFERRER_POLICY,
    ];
}

function apply_api_security_headers(): void {
    if (headers_sent()) return;
    foreach (api_security_headers() as $name => $value) {
        header($name . ': ' . $value);
    }
}
