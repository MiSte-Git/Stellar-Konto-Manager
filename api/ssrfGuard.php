<?php
// SSRF-safe HTTP fetch helpers for api/trade.php's server-side requests to a
// client-supplied home_domain (search results / issuer facts -> stellar.toml).
// Split out from trade.php so it can be exercised directly by
// test/ssrfGuard.test.php without pulling in trade.php's routing (which runs
// to completion - and exits - as soon as it's required).
declare(strict_types=1);

const MAX_FETCH_REDIRECTS = 5;
const MAX_FETCH_RESPONSE_BYTES = 1_000_000; // 1 MiB - generous for JSON/TOML, blocks a memory-DoS response (N2)

// Allows only public, non-reserved IPs (blocks RFC1918, loopback, link-local/metadata, IPv6 equivalents).
function is_public_ip_address(string $ip): bool {
    return filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) !== false;
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

function fetch_url(string $url, string $acceptHeader, int $timeoutSeconds): string {
    $currentUrl = $url;
    for ($redirect = 0; $redirect <= MAX_FETCH_REDIRECTS; $redirect++) {
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
                CURLOPT_CONNECTTIMEOUT => $timeoutSeconds,
                CURLOPT_TIMEOUT => $timeoutSeconds,
                CURLOPT_HTTPHEADER => [
                    'Accept: ' . $acceptHeader,
                    'User-Agent: Stellar-Konto-Manager/1.0',
                ],
                // N2: reject as soon as a declared Content-Length is too large,
                // without waiting for the body to start arriving.
                CURLOPT_HEADERFUNCTION => function ($handle, $headerLine) use (&$tooLarge) {
                    if (preg_match('/^content-length:\s*(\d+)/i', $headerLine, $m) && (int)$m[1] > MAX_FETCH_RESPONSE_BYTES) {
                        $tooLarge = true;
                        return -1; // any value != strlen($headerLine) aborts the transfer
                    }
                    return strlen($headerLine);
                },
                // N2: also enforced while streaming, in case Content-Length was
                // absent, chunked, or understated.
                CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$bodyChunks, &$bytesWritten, &$tooLarge) {
                    $bytesWritten += strlen($chunk);
                    if ($bytesWritten > MAX_FETCH_RESPONSE_BYTES) {
                        $tooLarge = true;
                        return 0; // any value != strlen($chunk) aborts the transfer
                    }
                    $bodyChunks[] = $chunk;
                    return strlen($chunk);
                },
            ]);
            $ok = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $error = curl_error($ch);
            if ($tooLarge) {
                curl_close($ch);
                throw new RuntimeException('ssrf_blocked_response_too_large');
            }
            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: null;
                curl_close($ch);
                if (!$location) {
                    throw new RuntimeException('redirect_without_location');
                }
                $currentUrl = $location;
                continue;
            }
            curl_close($ch);
            if ($ok === false || $status >= 400) {
                throw new RuntimeException($error !== '' ? $error : 'HTTP ' . ($status ?: 'fetch_failed'));
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
                'header' => "Accept: {$acceptHeader}\r\nUser-Agent: Stellar-Konto-Manager/1.0\r\nHost: {$target['hostHeader']}\r\n",
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
        $body = @file_get_contents($pinnedUrl, false, $context, 0, MAX_FETCH_RESPONSE_BYTES + 1);
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
            if (!$location) {
                throw new RuntimeException('redirect_without_location');
            }
            $currentUrl = $location;
            continue;
        }
        if ($body === false || $status >= 400) {
            throw new RuntimeException('HTTP ' . ($status ?: 'fetch_failed'));
        }
        if (strlen($body) > MAX_FETCH_RESPONSE_BYTES) {
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

function fetch_text(string $url): string {
    return fetch_url($url, 'text/plain, application/toml, */*', 6);
}
