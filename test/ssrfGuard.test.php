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
// - N2 (response size limit): die curl-Callbacks aus skm_curl_size_limit_callbacks() mit echtem curl gegen
//   einen lokalen php -S, der ohne Content-Length in Stuecken streamt (Abbruch beim Lesen) bzw. ein zu grosses
//   Content-Length meldet (Abbruch vor dem Body). fetch_url selbst erreicht 127.0.0.1 nicht (SSRF-Schutz),
//   darum die Callbacks direkt; dass fetch_url sie nutzt, prueft eine Quelltextpruefung.
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

// --- F-7: gemeinsame Fixture test/assets/ssrf-addresses.json (gleiche Faelle in test/ssrfGuard.test.js) ---
// Adressen binaer (inet_pton), IPv4-mapped und IPv4-compatible wie IPv4, auch in Hex, 100.64.0.0/10,
// 198.18.0.0/15, 64:ff9b::/96 und 64:ff9b:1::/48 gesperrt.
$ssrfFixture = json_decode((string)file_get_contents(__DIR__ . '/assets/ssrf-addresses.json'), true);
foreach ($ssrfFixture['addresses'] as $c) {
    $label = 'F-7 Adresse ' . json_encode($c['address']) . ' -> ' . ($c['blocked'] ? 'gesperrt' : 'erlaubt');
    check("{$label} (is_public_ip_address)", is_public_ip_address($c['address']) === !$c['blocked']);
    if (($c['url'] ?? true) !== false) {
        $host = strpos($c['address'], ':') !== false ? '[' . $c['address'] . ']' : $c['address'];
        if ($c['blocked']) {
            check("{$label} (literaler Host)", throws(fn() => resolve_safe_host($host), 'ssrf_blocked_ip'));
        } else {
            $r = null;
            try { $r = resolve_safe_host($host); } catch (\Throwable $e) { $r = null; }
            check("{$label} (literaler Host)", is_array($r) && ($r['address'] ?? '') === $c['address']);
        }
    }
}
foreach ($ssrfFixture['redirects'] as $r) {
    $label = 'F-7 Weiterleitung ' . $r['current'] . ' + ' . json_encode($r['location']) . ' -> ' . ($r['result'] ?? $r['error']);
    if (isset($r['result'])) {
        $next = null;
        try { $next = skm_next_redirect_url($r['current'], $r['location']); } catch (\Throwable $e) { $next = 'Fehler: ' . $e->getMessage(); }
        check($label, $next === $r['result']);
    } else {
        check($label, throws(fn() => skm_next_redirect_url($r['current'], $r['location']), $r['error'] === 'scheme' ? 'ssrf_blocked_scheme' : 'redirect_without_location'));
    }
}
check('F-7: fetch_text nur ueber https (http wird vor jeder DNS-Abfrage abgelehnt)',
    throws(fn() => fetch_text('http://203.0.113.10/.well-known/stellar.toml'), 'ssrf_blocked_scheme'));
$guardSource = (string)file_get_contents(__DIR__ . '/../api/ssrfGuard.php');
check('F-7: curl nur mit https-Protokoll fuer Weiterleitungen (CURLOPT_REDIR_PROTOCOLS) und bei httpsOnly auch fuer den Abruf',
    strpos($guardSource, 'CURLOPT_REDIR_PROTOCOLS') !== false && strpos($guardSource, 'CURLOPT_PROTOCOLS') !== false);
check('F-7: beide Wege (curl und Stream) folgen Weiterleitungen nur ueber skm_next_redirect_url',
    substr_count($guardSource, 'skm_next_redirect_url($currentUrl, $location)') === 2);

// N2: Abbruch beim Lesen mit echtem curl (Logo-Proxy: 256 KB, api/assetLogo.php).
$n2Dir = sys_get_temp_dir() . '/skm-ssrf-n2-' . bin2hex(random_bytes(4));
mkdir($n2Dir, 0775, true);
file_put_contents($n2Dir . '/router.php', <<<'PHP'
<?php
// /stream: 64 Stuecke zu 16 KB (1 MB) ohne Content-Length. /declared: Content-Length 10 MB, kurzer Body.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$log = __DIR__ . '/sent.txt';
if ($path === '/declared') { header('Content-Length: 10000000'); echo 'x'; return true; }
if ($path === '/drip') {
    // 1 Byte alle 200 ms, 50 Sekunden lang: jedes einzelne Lesen ist schnell, nur die Gesamtzeit ist zu lang.
    for ($i = 0; $i < 250; $i++) { echo 'd'; flush(); usleep(200000); }
    return true;
}
file_put_contents($log, '0');
for ($i = 1; $i <= 64; $i++) {
    echo str_repeat('a', 16384);
    flush();
    file_put_contents($log, (string)$i);
    usleep(20000);
}
return true;
PHP);
$n2Port = 3977;
$n2Server = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . $n2Port, $n2Dir . '/router.php'],
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $n2Pipes, $n2Dir);
try {
    $ready = false;
    for ($i = 0; $i < 100 && !$ready; $i++) {
        $sock = @fsockopen('127.0.0.1', $n2Port);
        if ($sock) { fclose($sock); $ready = true; } else { usleep(50000); }
    }
    check('N2: lokaler Testserver laeuft', $ready);
    $limit = 256 * 1024;
    $run = function (string $path) use ($n2Port, $limit): array {
        $chunks = [];
        $tooLarge = false;
        $ch = curl_init('http://127.0.0.1:' . $n2Port . $path);
        curl_setopt_array($ch, [CURLOPT_TIMEOUT => 20] + skm_curl_size_limit_callbacks($limit, $chunks, $tooLarge));
        $ok = curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        return ['ok' => $ok, 'errno' => $errno, 'tooLarge' => $tooLarge, 'bytes' => strlen(implode('', $chunks))];
    };
    $r = $run('/stream');
    usleep(300000);
    $sent = (int)@file_get_contents($n2Dir . '/sent.txt');
    check('N2: Stream ueber der Grenze -> tooLarge, curl bricht ab', $r['ok'] === false && $r['tooLarge'] === true && $r['errno'] === CURLE_WRITE_ERROR);
    check('N2: behalten werden hoechstens maxBytes', $r['bytes'] <= $limit);
    check("N2: Abbruch beim Lesen, nicht erst am Ende (Server kam bis Stueck {$sent} von 64)", $sent > 0 && $sent < 64);
    $r = $run('/declared');
    check('N2: zu grosses Content-Length -> Abbruch vor dem Body', $r['ok'] === false && $r['tooLarge'] === true && $r['bytes'] === 0);

    // LP-1: Stream-Fallback mit Gesamtfrist. Ein tropfender Server haelt den Lesevorgang nicht ueber die Frist.
    $fp = fopen('http://127.0.0.1:' . $n2Port . '/drip', 'rb', false, stream_context_create(['http' => ['timeout' => 5]]));
    $started = microtime(true);
    $msg = '';
    try {
        skm_stream_read_limited($fp, 1000, $started + 1.0);
    } catch (Throwable $e) {
        $msg = $e->getMessage();
    } finally {
        fclose($fp);
    }
    $elapsed = microtime(true) - $started;
    check(sprintf('LP-1: tropfender Server -> timeout nach der Frist (%.2f s)', $elapsed), $msg === 'timeout' && $elapsed >= 0.9 && $elapsed < 2.5);
    $fp = fopen('http://127.0.0.1:' . $n2Port . '/stream', 'rb');
    $msg = '';
    try {
        skm_stream_read_limited($fp, 256 * 1024, microtime(true) + 20);
    } catch (Throwable $e) {
        $msg = $e->getMessage();
    } finally {
        fclose($fp);
    }
    check('LP-1/N2: Stream-Fallback bricht ueber maxBytes ab', $msg === 'ssrf_blocked_response_too_large');
} finally {
    proc_terminate($n2Server);
    proc_close($n2Server);
    array_map('unlink', glob($n2Dir . '/*') ?: []);
    @rmdir($n2Dir);
}
$expired = '';
try { skm_fetch_remaining_ms(microtime(true) - 0.001); } catch (Throwable $e) { $expired = $e->getMessage(); }
check('LP-1: abgelaufene Frist -> timeout', $expired === 'timeout');
$ms = skm_fetch_remaining_ms(microtime(true) + 2.0);
check('LP-1: Restzeit in ms', $ms > 1900 && $ms <= 2000);
check('LP-1: curl bekommt die Restzeit, nicht die volle Frist je Weiterleitung',
    strpos($guardSource, 'CURLOPT_TIMEOUT_MS => $remainingMs') !== false
    && strpos($guardSource, 'CURLOPT_CONNECTTIMEOUT_MS => $remainingMs') !== false
    && strpos($guardSource, 'CURLOPT_TIMEOUT => $timeoutSeconds') === false
    && substr_count($guardSource, '$deadline = microtime(true) + $timeoutSeconds;') === 1);
check('LP-1: Stream-Fallback liest ueber skm_stream_read_limited, nicht file_get_contents',
    strpos($guardSource, 'skm_stream_read_limited($fp, $maxBytes, $deadline)') !== false
    && strpos($guardSource, 'file_get_contents($pinnedUrl') === false);
check('LP-5: beide Wege lehnen uebrige 3xx mit HTTP nnn ab',
    substr_count($guardSource, "&& \$status >= 300 && \$status < 400) {\n                throw new RuntimeException('HTTP ' . \$status);") === 1
    && substr_count($guardSource, "&& \$status >= 300 && \$status < 400) {\n            throw new RuntimeException('HTTP ' . \$status);") === 1);
check('N2: fetch_url nutzt skm_curl_size_limit_callbacks mit maxBytes',
    strpos($guardSource, '+ skm_curl_size_limit_callbacks($maxBytes, $bodyChunks, $tooLarge)') !== false);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
