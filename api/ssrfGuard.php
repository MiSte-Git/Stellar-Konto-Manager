<?php
// SSRF-safe HTTP fetch helpers for api/trade.php's server-side requests to a
// client-supplied home_domain (search results / issuer facts -> stellar.toml).
// Split out from trade.php so it can be exercised directly by
// test/ssrfGuard.test.php without pulling in trade.php's routing (which runs
// to completion - and exits - as soon as it's required).
declare(strict_types=1);

const MAX_FETCH_REDIRECTS = 5;
const MAX_FETCH_RESPONSE_BYTES = 1_000_000; // 1 MiB - generous for JSON/TOML, blocks a memory-DoS response (N2)

// F-7: Adressen werden binaer geprueft (inet_pton), nicht per filter_var-Flags. Vorher kamen 100.64.0.0/10,
// 198.18.0.0/15, NAT64 (64:ff9b::/96) und IPv4-compatible (::7f00:1) durch. Gleiche Regeln wie
// services/ssrfGuard.js, gemeinsame Faelle in test/assets/ssrf-addresses.json.

// IPv4 (4 Bytes): nicht oeffentlich routbar oder auf den Server selbst. Dokumentationsnetze bleiben erlaubt.
function skm_is_blocked_ipv4_bytes(string $b): bool {
    [$a, $o2, $o3] = [ord($b[0]), ord($b[1]), ord($b[2])];
    if ($a === 0) return true;                               // 0.0.0.0/8
    if ($a === 10) return true;                              // 10.0.0.0/8
    if ($a === 100 && ($o2 & 0xc0) === 64) return true;      // 100.64.0.0/10 (Carrier-Grade NAT)
    if ($a === 127) return true;                             // 127.0.0.0/8 (Loopback)
    if ($a === 169 && $o2 === 254) return true;              // 169.254.0.0/16 (Link-Local, Cloud-Metadaten)
    if ($a === 172 && ($o2 & 0xf0) === 16) return true;      // 172.16.0.0/12
    if ($a === 192 && $o2 === 0 && $o3 === 0) return true;   // 192.0.0.0/24 (IETF)
    if ($a === 192 && $o2 === 168) return true;              // 192.168.0.0/16
    if ($a === 198 && ($o2 & 0xfe) === 18) return true;      // 198.18.0.0/15 (Benchmark)
    if ($a >= 224) return true;                              // Multicast, reserviert, Broadcast
    return false;
}

// Gesperrt? Keine gueltige Adresse: gesperrt (fail closed). Ein Zonen-Index (fe80::1%eth0) wird abgeschnitten.
function skm_is_blocked_address(string $ip): bool {
    $s = trim($ip);
    $zone = strpos($s, '%');
    if ($zone !== false) $s = substr($s, 0, $zone);
    if ($s === '') return true;
    $b = @inet_pton($s);
    if ($b === false) return true;
    if (strlen($b) === 4) return skm_is_blocked_ipv4_bytes($b);
    if (strlen($b) !== 16) return true;
    // ::ffff:0:0/96 (IPv4-mapped): wie die IPv4-Adresse.
    if (substr($b, 0, 10) === str_repeat("\0", 10) && substr($b, 10, 2) === "\xff\xff") return skm_is_blocked_ipv4_bytes(substr($b, 12));
    // ::/96: :: und ::1 gesperrt, sonst IPv4-compatible wie die IPv4-Adresse.
    if (substr($b, 0, 12) === str_repeat("\0", 12)) {
        if (substr($b, 12, 3) === "\0\0\0" && ord($b[15]) <= 1) return true;
        return skm_is_blocked_ipv4_bytes(substr($b, 12));
    }
    // 64:ff9b::/96 (NAT64) und 64:ff9b:1::/48 (lokales NAT64): ganz gesperrt.
    if (substr($b, 0, 4) === "\x00\x64\xff\x9b") {
        if (substr($b, 4, 8) === str_repeat("\0", 8)) return true;
        if (substr($b, 4, 2) === "\x00\x01") return true;
    }
    $b0 = ord($b[0]);
    $b1 = ord($b[1]);
    if ($b0 === 0xfe && ($b1 & 0xc0) === 0x80) return true; // fe80::/10 Link-Local
    if ($b0 === 0xfe && ($b1 & 0xc0) === 0xc0) return true; // fec0::/10 Site-Local (veraltet)
    if (($b0 & 0xfe) === 0xfc) return true;                 // fc00::/7 Unique-Local
    if ($b0 === 0xff) return true;                          // ff00::/8 Multicast
    return false;
}

// Allows only public, non-reserved IPs (siehe skm_is_blocked_address).
function is_public_ip_address(string $ip): bool {
    return !skm_is_blocked_address($ip);
}

/**
 * F-7: Naechste URL einer von Hand verfolgten Weiterleitung. Relative Location wird gegen die aktuelle URL
 * aufgeloest; das Ergebnis muss https sein. Gleich wie nextRedirectUrl in services/ssrfGuard.js.
 */
function skm_next_redirect_url(string $currentUrl, ?string $location): string {
    if ($location === null || $location === '') throw new RuntimeException('redirect_without_location');
    if (preg_match('#^([a-z][a-z0-9+.-]*):#i', $location, $m)) {
        $next = $location;
    } else {
        $cur = parse_url($currentUrl);
        if ($cur === false || !isset($cur['scheme'], $cur['host'])) throw new RuntimeException('ssrf_blocked_invalid_url');
        if (strpos($location, '//') === 0) {
            $next = $cur['scheme'] . ':' . $location;
        } else {
            $origin = $cur['scheme'] . '://' . $cur['host'] . (isset($cur['port']) ? ':' . $cur['port'] : '');
            if ($location[0] === '/') {
                $next = $origin . $location;
            } else {
                $path = $cur['path'] ?? '/';
                $next = $origin . substr($path, 0, (int)strrpos($path, '/') + 1) . $location;
            }
        }
    }
    if (strtolower((string)parse_url($next, PHP_URL_SCHEME)) !== 'https') throw new RuntimeException('ssrf_blocked_scheme');
    return $next;
}

// Resolves $host to exactly one validated, public IP (N1 fix). Previously,
// this validated every address a *separate* lookup returned, and then curl/
// file_get_contents performed their own, independent lookup moments later to
// actually connect - a DNS-rebinding attacker controlling the target's
// nameserver could answer the first lookup with a public IP (passing
// validation) and the second with a private one (e.g. cloud metadata),
// completing the SSRF after the check already passed. Returning a single
// pinned address here, which the caller then forces the actual connection to
// use (CURLOPT_RESOLVE / a rewritten stream URL - see fetch_url() below),
// means there is only one resolution in the whole flow: the address
// validated here is unconditionally the address that gets connected to.
function resolve_safe_host(string $host): array {
    // parse_url() keeps the brackets PHP requires around a literal IPv6 host
    // in a URL (e.g. "[::1]"), which is not valid filter_var(..., FILTER_VALIDATE_IP)
    // syntax on its own - strip them so a bracketed literal is recognized and
    // validated explicitly below, instead of merely failing to resolve as an
    // (accidentally still-blocked, but not for the right reason) hostname.
    $bareHost = preg_match('/^\[(.+)\]$/', $host, $m) ? $m[1] : $host;
    $normalized = strtolower(rtrim($bareHost, '.'));
    if ($normalized === 'localhost' || substr($normalized, -10) === '.localhost') {
        throw new RuntimeException('ssrf_blocked_localhost');
    }

    if (filter_var($bareHost, FILTER_VALIDATE_IP) !== false) {
        if (!is_public_ip_address($bareHost)) {
            throw new RuntimeException('ssrf_blocked_ip');
        }
        return ['address' => $bareHost, 'family' => strpos($bareHost, ':') !== false ? 6 : 4];
    }

    $addresses = [];
    $ipv4List = @gethostbynamel($host);
    if (is_array($ipv4List)) {
        foreach ($ipv4List as $ip) {
            $addresses[] = ['address' => $ip, 'family' => 4];
        }
    }
    if (function_exists('dns_get_record')) {
        $aaaaRecords = @dns_get_record($host, DNS_AAAA);
        if (is_array($aaaaRecords)) {
            foreach ($aaaaRecords as $record) {
                if (!empty($record['ipv6'])) {
                    $addresses[] = ['address' => $record['ipv6'], 'family' => 6];
                }
            }
        }
    }
    if (empty($addresses)) {
        throw new RuntimeException('ssrf_blocked_unresolved');
    }
    foreach ($addresses as $addr) {
        if (!is_public_ip_address($addr['address'])) {
            throw new RuntimeException('ssrf_blocked_ip');
        }
    }
    // All resolved addresses passed validation; pin to the first one.
    return $addresses[0];
}

// Validates scheme and resolves+validates the host of a URL, returning
// everything fetch_url() needs to pin the actual connection to that single
// validated address.
function resolve_safe_fetch_target(string $url): array {
    $parts = parse_url($url);
    if ($parts === false) {
        throw new RuntimeException('ssrf_blocked_invalid_url');
    }
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true)) {
        throw new RuntimeException('ssrf_blocked_scheme');
    }
    $host = (string)($parts['host'] ?? '');
    if ($host === '') {
        throw new RuntimeException('ssrf_blocked_host');
    }
    $resolved = resolve_safe_host($host);
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    $path = ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
    $defaultPort = $scheme === 'https' ? 443 : 80;

    return [
        'scheme' => $scheme,
        'host' => $host,
        'port' => (int)$port,
        'path' => $path,
        'address' => $resolved['address'],
        'family' => $resolved['family'],
        'hostHeader' => $port === $defaultPort ? $host : "{$host}:{$port}",
    ];
}

// $options (all optional, defaults = previous behavior used by trade.php):
//   httpsOnly    => bool, reject any non-https URL (also on redirects)
//   maxRedirects => int, 0 turns every 3xx into 'too_many_redirects'
//   maxBytes     => int, response size cap
//   headers      => string[], extra request headers ("Name: value")
// With maxRedirects 0 every 3xx status is a failure, not only the five
// redirect codes (a 300/304/305 body is never returned).
// Used by api/federationService.php with httpsOnly + maxRedirects 0.
function fetch_url(string $url, string $acceptHeader, int $timeoutSeconds, array $options = []): string {
    $httpsOnly = (bool)($options['httpsOnly'] ?? false);
    $maxRedirects = (int)($options['maxRedirects'] ?? MAX_FETCH_REDIRECTS);
    $maxBytes = (int)($options['maxBytes'] ?? MAX_FETCH_RESPONSE_BYTES);
    $extraHeaders = array_values(array_filter((array)($options['headers'] ?? []), 'is_string'));
    $currentUrl = $url;
    for ($redirect = 0; $redirect <= $maxRedirects; $redirect++) {
        // Before any DNS resolution, so a non-https target never causes a lookup.
        if ($httpsOnly && strtolower((string)parse_url($currentUrl, PHP_URL_SCHEME)) !== 'https') {
            throw new RuntimeException('ssrf_blocked_scheme');
        }
        $target = resolve_safe_fetch_target($currentUrl);

        if (function_exists('curl_init')) {
            $ch = curl_init();
            if ($ch === false) {
                throw new RuntimeException('curl_init_failed');
            }
            $bodyChunks = [];
            $bytesWritten = 0;
            $tooLarge = false;
            curl_setopt_array($ch, [
                CURLOPT_URL => $currentUrl,
                // Pins the connection to the address resolve_safe_fetch_target()
                // already validated, instead of letting curl re-resolve $host
                // itself moments later (the DNS-rebinding TOCTOU gap this fixes -
                // see resolve_safe_host()). curl still sends the original Host
                // header and validates TLS/SNI against $target['host'], exactly
                // as it would without this option.
                CURLOPT_RESOLVE => ["{$target['host']}:{$target['port']}:{$target['address']}"],
                CURLOPT_FOLLOWLOCATION => false,
                // F-7: nur https, wo verlangt; Weiterleitungen (von Hand verfolgt, siehe skm_next_redirect_url)
                // nie auf etwas anderes als https.
                CURLOPT_PROTOCOLS => $httpsOnly ? CURLPROTO_HTTPS : (CURLPROTO_HTTP | CURLPROTO_HTTPS),
                CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT => $timeoutSeconds,
                CURLOPT_TIMEOUT => $timeoutSeconds,
                CURLOPT_HTTPHEADER => array_merge([
                    'Accept: ' . $acceptHeader,
                    'User-Agent: Stellar-Konto-Manager/1.0',
                ], $extraHeaders),
                // N2: reject as soon as a declared Content-Length is too large,
                // without waiting for the body to start arriving.
                CURLOPT_HEADERFUNCTION => function ($handle, $headerLine) use (&$tooLarge, $maxBytes) {
                    if (preg_match('/^content-length:\s*(\d+)/i', $headerLine, $m) && (int)$m[1] > $maxBytes) {
                        $tooLarge = true;
                        return -1; // any value != strlen($headerLine) aborts the transfer
                    }
                    return strlen($headerLine);
                },
                // N2: also enforced while streaming, in case Content-Length was
                // absent, chunked, or understated.
                CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$bodyChunks, &$bytesWritten, &$tooLarge, $maxBytes) {
                    $bytesWritten += strlen($chunk);
                    if ($bytesWritten > $maxBytes) {
                        $tooLarge = true;
                        return 0; // any value != strlen($chunk) aborts the transfer
                    }
                    $bodyChunks[] = $chunk;
                    return strlen($chunk);
                },
            ]);
            $ok = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $errno = curl_errno($ch);
            if ($tooLarge) {
                curl_close($ch);
                throw new RuntimeException('ssrf_blocked_response_too_large');
            }
            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: null;
                curl_close($ch);
                $currentUrl = skm_next_redirect_url($currentUrl, $location);
                continue;
            }
            curl_close($ch);
            if ($maxRedirects === 0 && $status >= 300 && $status < 400) {
                throw new RuntimeException('too_many_redirects');
            }
            // curl_errno() (not the locale-dependent curl_error() text) tells
            // a real timeout apart from every other connection-level failure
            // (refused, reset, TLS) - DNS itself already succeeded via
            // resolve_safe_host() before curl ever runs, so a curl-level
            // failure here is always post-DNS.
            if ($ok === false) {
                throw new RuntimeException($errno === CURLE_OPERATION_TIMEDOUT ? 'timeout' : 'connection_error');
            }
            if ($status >= 400) {
                throw new RuntimeException('HTTP ' . $status);
            }
            return implode('', $bodyChunks);
        }

        // Stream fallback: rewrite the URL to connect directly to the
        // validated address (same pinning purpose as CURLOPT_RESOLVE above),
        // sending the original Host header and verifying TLS against the
        // original hostname via the "peer_name" ssl context option.
        $connectHost = $target['family'] === 6 ? "[{$target['address']}]" : $target['address'];
        $pinnedUrl = "{$target['scheme']}://{$connectHost}:{$target['port']}{$target['path']}";
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => $timeoutSeconds,
                'header' => "Accept: {$acceptHeader}\r\nUser-Agent: Stellar-Konto-Manager/1.0\r\nHost: {$target['hostHeader']}\r\n"
                    . implode('', array_map(fn($h) => $h . "\r\n", $extraHeaders)),
                'ignore_errors' => true,
                'follow_location' => 0,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'peer_name' => $target['host'],
                'SNI_enabled' => true,
            ],
        ]);
        // N2: maxlen caps how many bytes PHP ever buffers for this call,
        // regardless of what the (possibly lying) remote end declares or how
        // much it actually sends.
        $body = @file_get_contents($pinnedUrl, false, $context, 0, $maxBytes + 1);
        $status = 0;
        $location = null;
        foreach (($http_response_header ?? []) as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $m)) {
                $status = (int)$m[1];
            }
            if (stripos($header, 'Location:') === 0) {
                $location = trim(substr($header, strlen('Location:')));
            }
        }
        if (in_array($status, [301, 302, 303, 307, 308], true)) {
            $currentUrl = skm_next_redirect_url($currentUrl, $location);
            continue;
        }
        if ($maxRedirects === 0 && $status >= 300 && $status < 400) {
            throw new RuntimeException('too_many_redirects');
        }
        if ($body === false) {
            // No curl_errno() equivalent is available here (rare fallback
            // path, only used when the curl extension is absent); the last
            // stream warning is the only signal left to tell a timeout apart
            // from any other connection-level failure.
            $lastError = strtolower((string)(error_get_last()['message'] ?? ''));
            throw new RuntimeException(strpos($lastError, 'timed out') !== false ? 'timeout' : 'connection_error');
        }
        if ($status >= 400) {
            throw new RuntimeException('HTTP ' . $status);
        }
        if (strlen($body) > $maxBytes) {
            throw new RuntimeException('ssrf_blocked_response_too_large');
        }
        return $body;
    }
    throw new RuntimeException('too_many_redirects');
}

function fetch_json(string $url): array {
    $body = fetch_url($url, 'application/json', 8);
    $data = json_decode($body, true);
    if (!is_array($data)) {
        throw new RuntimeException('invalid_json');
    }
    return $data;
}

// F-7: stellar.toml nur ueber https (auch jede Weiterleitung), wie Node fetchTextWithTimeout.
function fetch_text(string $url): string {
    return fetch_url($url, 'text/plain, application/toml, */*', 6, ['httpsOnly' => true]);
}

// A server answering with an HTML error/redirect page instead of the TOML
// file (misconfiguration, WAF/CDN block page) is common enough to deserve
// its own "invalidFormat" category, rather than being silently parsed as an
// empty CURRENCIES list by trade.php's line-based parser.
function looks_like_html(string $text): bool {
    return (bool)preg_match('/^\s*<(!doctype|html)/i', $text);
}

// Normalizes the wide range of internal fetch failures raised above into the
// same small, UI-stable category set the Node implementation
// (classifyTomlError() in services/tradeService.js) uses, so the frontend
// can render one shared set of error labels regardless of which backend
// answered. Raw internal messages (ssrf_blocked_*, HTTP nnn, ...) are left
// unchanged at their throw sites in fetch_url(); this classification only
// applies where trade.php's asset_facts() turns a caught exception into the
// public toml.error field.
function classify_toml_error(string $error): string {
    if ($error === 'timeout') return 'timeout';
    if ($error === 'connection_error') return 'connectionError';
    if ($error === 'toml_invalid_format') return 'invalidFormat';

    if (preg_match('/^HTTP (\d+)$/', $error, $m)) {
        return $m[1] === '404' ? 'notFound' : 'httpError';
    }
    // DNS never resolving at all is a domain-availability problem, not our
    // guard actively intervening for safety - same distinction as Node's
    // classifyTomlError() for 'ssrf.blocked:dnsLookupFailed'/'noAddress'.
    if ($error === 'ssrf_blocked_unresolved') return 'connectionError';
    if (strpos($error, 'ssrf_blocked_') === 0) return 'blocked';
    if ($error === 'redirect_without_location' || $error === 'too_many_redirects') return 'blocked';

    return 'fetchFailed';
}
