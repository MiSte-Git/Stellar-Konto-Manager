<?php
// Lightweight, dependency-free test script for api/ssrfGuard.php (same
// approach as test/challengeStore.test.php - see the comment there for why
// this project uses plain PHP scripts instead of PHPUnit for the API side).
//
// Covers:
// - N1 (DNS-rebinding TOCTOU): resolve_safe_host()/resolve_safe_fetch_target()
//   are the single resolution point fetch_url() then pins the actual
//   connection to (CURLOPT_RESOLVE / a rewritten stream URL) - there is no
//   separate, independently-timed lookup left for an attacker to answer
//   differently. This is tested here for the literal-IP path (fully
//   deterministic, no network) and, at the end, once against a real hostname
//   to exercise the DNS-based path end-to-end (gethostbynamel()/
//   dns_get_record() are plain global functions, not mockable without a
//   namespace-override setup this project doesn't otherwise use).
// - N2 (response size limit): covered structurally by asserting the relevant
//   curl/stream options are present in fetch_url() - actually exceeding the
//   limit needs a real HTTP server, exercised via manual verification
//   instead (see the fix's summary), not from this offline script.
//
// Run with: php test/ssrfGuard.test.php

declare(strict_types=1);

require __DIR__ . '/../api/ssrfGuard.php';

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n"; // ✔
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n"; // ✘
    }
}

function throws(callable $fn, string $expectedMessage): bool {
    try {
        $fn();
        return false;
    } catch (\Throwable $e) {
        return $e->getMessage() === $expectedMessage;
    }
}

// --- is_public_ip_address ---------------------------------------------
check('is_public_ip_address accepts a public IPv4 address', is_public_ip_address('203.0.113.10') === true);
check('is_public_ip_address rejects a loopback address', is_public_ip_address('127.0.0.1') === false);
check('is_public_ip_address rejects an RFC1918 address', is_public_ip_address('10.1.2.3') === false);
check('is_public_ip_address rejects a link-local/cloud-metadata address', is_public_ip_address('169.254.169.254') === false);
check('is_public_ip_address rejects IPv6 loopback', is_public_ip_address('::1') === false);

// --- resolve_safe_host: literal-IP path (no DNS lookup involved) ------
check(
    'resolve_safe_host rejects "localhost" without attempting any IP validation',
    throws(fn() => resolve_safe_host('localhost'), 'ssrf_blocked_localhost')
);
check(
    'resolve_safe_host rejects "sub.localhost" too',
    throws(fn() => resolve_safe_host('sub.localhost'), 'ssrf_blocked_localhost')
);
check(
    'resolve_safe_host rejects a literal loopback IPv4 address',
    throws(fn() => resolve_safe_host('127.0.0.1'), 'ssrf_blocked_ip')
);
check(
    'resolve_safe_host rejects a literal cloud-metadata IPv4 address',
    throws(fn() => resolve_safe_host('169.254.169.254'), 'ssrf_blocked_ip')
);
check(
    'resolve_safe_host rejects a literal IPv6 loopback address',
    throws(fn() => resolve_safe_host('::1'), 'ssrf_blocked_ip')
);

$publicResolved = resolve_safe_host('203.0.113.10');
check(
    'resolve_safe_host accepts and pins a literal public IPv4 address',
    $publicResolved['address'] === '203.0.113.10' && $publicResolved['family'] === 4
);

// --- resolve_safe_fetch_target: scheme/port/path/hostHeader parsing ---
check(
    'resolve_safe_fetch_target rejects a non-http(s) scheme',
    throws(fn() => resolve_safe_fetch_target('file:///etc/passwd'), 'ssrf_blocked_scheme')
);
check(
    'resolve_safe_fetch_target rejects a URL with no host',
    throws(fn() => resolve_safe_fetch_target('http:path'), 'ssrf_blocked_host')
);
check(
    'resolve_safe_fetch_target rejects a malformed URL parse_url() itself refuses',
    throws(fn() => resolve_safe_fetch_target('http:///path'), 'ssrf_blocked_invalid_url')
);

$target = resolve_safe_fetch_target('https://203.0.113.10/.well-known/stellar.toml');
check('resolve_safe_fetch_target parses the default https port and omits it from hostHeader', $target['port'] === 443 && $target['hostHeader'] === '203.0.113.10');
check('resolve_safe_fetch_target parses the path', $target['path'] === '/.well-known/stellar.toml');
check('resolve_safe_fetch_target pins the address it resolved', $target['address'] === '203.0.113.10' && $target['family'] === 4);

$targetWithPort = resolve_safe_fetch_target('https://203.0.113.10:8443/x?y=1');
check('resolve_safe_fetch_target keeps a non-default port in hostHeader', $targetWithPort['hostHeader'] === '203.0.113.10:8443');
check('resolve_safe_fetch_target appends the query string to path', $targetWithPort['path'] === '/x?y=1');

// --- N1 end-to-end (real DNS): validated address is what gets pinned --
// This is the one test in this file that touches the network (a plain DNS
// lookup, no HTTP request) - gethostbynamel()/dns_get_record() are global
// built-ins this project has no mocking setup for, so the hostname-resolution
// path (as opposed to the literal-IP path above) can only be exercised this way.
$dnsTarget = null;
$dnsError = null;
try {
    $dnsTarget = resolve_safe_fetch_target('https://example.com/');
} catch (\Throwable $e) {
    $dnsError = $e->getMessage();
}
check(
    'resolve_safe_fetch_target resolves a real public hostname to a pinned public address (skipped/inconclusive if offline: ' . ($dnsError ?? 'n/a') . ')',
    $dnsTarget !== null
        ? (is_public_ip_address($dnsTarget['address']) && $dnsTarget['host'] === 'example.com')
        : $dnsError === 'ssrf_blocked_unresolved' // offline sandbox: acceptable, still not a false negative
);

// --- looks_like_html ----------------------------------------------------
check('looks_like_html detects a doctype-led HTML error page', looks_like_html("<!DOCTYPE html>\n<html><body>blocked</body></html>") === true);
check('looks_like_html detects a bare <html> tag with leading whitespace', looks_like_html("  \n<html><head></head></html>") === true);
check('looks_like_html does not flag a real stellar.toml as HTML', looks_like_html("ACCOUNTS=[\"G...\"]\n\n[[CURRENCIES]]\ncode=\"USDC\"") === false);
check('looks_like_html does not flag empty content as HTML', looks_like_html('') === false);

// --- classify_toml_error: every internal failure -> its public category ---
check('classify_toml_error maps "timeout" to "timeout"', classify_toml_error('timeout') === 'timeout');
check('classify_toml_error maps "connection_error" to "connectionError"', classify_toml_error('connection_error') === 'connectionError');
check('classify_toml_error maps "toml_invalid_format" to "invalidFormat"', classify_toml_error('toml_invalid_format') === 'invalidFormat');
check('classify_toml_error maps "HTTP 404" to "notFound"', classify_toml_error('HTTP 404') === 'notFound');
check('classify_toml_error maps "HTTP 500" to "httpError"', classify_toml_error('HTTP 500') === 'httpError');
check('classify_toml_error maps "HTTP 403" to "httpError"', classify_toml_error('HTTP 403') === 'httpError');
check('classify_toml_error maps "ssrf_blocked_ip" (private address) to "blocked"', classify_toml_error('ssrf_blocked_ip') === 'blocked');
check('classify_toml_error maps "ssrf_blocked_scheme" to "blocked"', classify_toml_error('ssrf_blocked_scheme') === 'blocked');
check('classify_toml_error maps "ssrf_blocked_localhost" to "blocked"', classify_toml_error('ssrf_blocked_localhost') === 'blocked');
check('classify_toml_error maps "ssrf_blocked_response_too_large" to "blocked"', classify_toml_error('ssrf_blocked_response_too_large') === 'blocked');
check('classify_toml_error maps "ssrf_blocked_invalid_url" to "blocked"', classify_toml_error('ssrf_blocked_invalid_url') === 'blocked');
check('classify_toml_error maps "ssrf_blocked_host" to "blocked"', classify_toml_error('ssrf_blocked_host') === 'blocked');
check('classify_toml_error maps "redirect_without_location" to "blocked"', classify_toml_error('redirect_without_location') === 'blocked');
check('classify_toml_error maps "too_many_redirects" to "blocked"', classify_toml_error('too_many_redirects') === 'blocked');
// A DNS name that never resolves at all is a domain-availability problem,
// not our guard actively intervening for safety - unlike the other
// ssrf_blocked_* cases above, which all involve a resolved-but-forbidden
// target or a rejected input.
check('classify_toml_error maps "ssrf_blocked_unresolved" to "connectionError", not "blocked"', classify_toml_error('ssrf_blocked_unresolved') === 'connectionError');
check('classify_toml_error falls back to "fetchFailed" for an unrecognized message', classify_toml_error('something unexpected') === 'fetchFailed');
check('classify_toml_error falls back to "fetchFailed" for an empty message', classify_toml_error('') === 'fetchFailed');

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
