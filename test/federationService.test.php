<?php
// Tests for api/federationService.php (SEP-2 via backend, Backlog P1.2).
// Runs the shared cases from test/assets/federationCases.json - the same
// file test/federationService.test.js runs against the Node twin.
//
// Run with: php test/federationService.test.php

declare(strict_types=1);

require __DIR__ . '/../api/federationService.php';

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

function canonical_url(string $raw): string {
    $parts = parse_url($raw);
    $params = [];
    if (isset($parts['query'])) {
        foreach (explode('&', $parts['query']) as $pair) {
            if ($pair === '') continue;
            [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
            $params[urldecode($k)] = urldecode($v);
        }
    }
    ksort($params, SORT_STRING);
    $query = implode('&', array_map(fn($k, $v) => "{$k}={$v}", array_keys($params), $params));
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return $origin . ($parts['path'] ?? '') . ($query !== '' ? '?' . $query : '');
}

function fake_fetch(array $responses, array &$calls): callable {
    $byUrl = [];
    foreach ($responses as $url => $response) $byUrl[canonical_url((string)$url)] = $response;
    return function (string $url, string $accept, int $maxBytes) use ($byUrl, &$calls): string {
        $calls[] = $url;
        if (strpos($url, 'https://') !== 0) throw new RuntimeException('non_https_request:' . $url);
        $response = $byUrl[canonical_url($url)] ?? null;
        if ($response === null) throw new RuntimeException('connection_error');
        if (isset($response['error'])) throw new RuntimeException($response['error']);
        if (array_key_exists('json', $response)) {
            // Keep {} as an object (PHP would encode an empty array as []).
            return $response['json'] === [] ? '{}' : json_encode($response['json']);
        }
        return (string)$response['text'];
    };
}

function home_domain_loader($value): callable {
    return function (string $id) use ($value): string {
        if (is_array($value) && isset($value['error'])) throw new RuntimeException($value['error']);
        return is_string($value) ? $value : '';
    };
}

$fixture = json_decode((string)file_get_contents(__DIR__ . '/assets/federationCases.json'), true);

foreach ($fixture['cases'] as $case) {
    $calls = [];
    $result = federation_handle_request(
        $case['query'],
        home_domain_loader($case['homeDomain'] ?? null),
        fake_fetch($case['responses'], $calls)
    );
    $nonHttps = array_filter($calls, fn($u) => strpos($u, 'https://') !== 0);
    $ok = $result === $case['expect'] && !$nonHttps;
    check('shared case: ' . $case['description'], $ok);
    if (!$ok) {
        echo '    expected ' . json_encode($case['expect']) . "\n";
        echo '    actual   ' . json_encode($result) . "\n";
    }
}

foreach ($fixture['accounts']['valid'] as $id) {
    check("account id valid: {$id}", federation_is_valid_account_id($id));
}
foreach ($fixture['accounts']['invalid'] as $id) {
    check("account id invalid: '{$id}'", !federation_is_valid_account_id($id));
}

// Reverse: the other domain's stellar.toml is never requested.
foreach ($fixture['cases'] as $case) {
    if (strpos($case['description'], 'reverse: stellar_address on another domain') !== 0) continue;
    $calls = [];
    federation_handle_request($case['query'], home_domain_loader($case['homeDomain']), fake_fetch($case['responses'], $calls));
    check('reverse lookup never asks for a stellar.toml other than the home_domain one',
        !array_filter($calls, fn($u) => strpos($u, 'evil.com') !== false));
}

// Non-string query params are invalid input (parity with the Node handler).
$r = federation_handle_request(['type' => 'name', 'q' => ['alice*example.com']], home_domain_loader(''), fn() => '');
check('query params must be strings', $r === ['status' => 400, 'body' => ['ok' => false, 'error' => 'federation.invalidInput']]);

// Default fetcher: https only, refused before any DNS lookup.
foreach (['http://example.com/.well-known/stellar.toml', 'ftp://example.com/x'] as $url) {
    $error = '';
    try {
        federation_default_fetch($url, '*/*', 10);
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
    check("default fetcher refuses {$url}", $error === 'ssrf_blocked_scheme');
}
$error = '';
try {
    federation_default_fetch('https://127.0.0.1/x', '*/*', 10);
} catch (Throwable $e) {
    $error = $e->getMessage();
}
check('default fetcher refuses a loopback IP literal', $error === 'ssrf_blocked_ip');

// Rate limit: 30 per window, then a Retry-After > 0.
$rateFile = sys_get_temp_dir() . '/skm_federation_rate_' . bin2hex(random_bytes(4)) . '.json';
putenv('FEDERATION_RATE_LIMIT_PATH=' . $rateFile);
$within = true;
for ($i = 0; $i < FEDERATION_RATE_LIMIT_MAX; $i++) {
    if (federation_rate_limit_check_and_record('198.51.100.7') !== 0) $within = false;
}
check('rate limit allows 30 requests per minute', $within);
check('rate limit blocks the 31st request', federation_rate_limit_check_and_record('198.51.100.7') > 0);
check('rate limit is per IP', federation_rate_limit_check_and_record('198.51.100.8') === 0);
// IPv6: keyed per /64, so rotating addresses inside one /64 shares a budget.
for ($i = 0; $i < FEDERATION_RATE_LIMIT_MAX; $i++) {
    federation_rate_limit_check_and_record('2001:db8:1:2::' . dechex($i + 1));
}
check('IPv6 addresses in one /64 share the budget', federation_rate_limit_check_and_record('2001:db8:1:2:ffff::1') > 0);
check('another /64 has its own budget', federation_rate_limit_check_and_record('2001:db8:1:3::1') === 0);
check('IPv4 keys stay per address', federation_rate_limit_key('198.51.100.7') === '198.51.100.7');
check('IPv4-mapped IPv6 is keyed by the embedded IPv4', federation_rate_limit_key('::ffff:1.2.3.4') === '1.2.3.4'
    && federation_rate_limit_key('::ffff:5.6.7.8') === '5.6.7.8');
@unlink($rateFile);
@unlink($rateFile . '.lock');
putenv('FEDERATION_RATE_LIMIT_PATH');

// Loop guard: a request marked as a federation hop is refused, nothing fetched.
$fetched = false;
$r = federation_handle_request(['type' => 'name', 'q' => 'alice*example.com'], home_domain_loader(''),
    function () use (&$fetched): string { $fetched = true; return ''; }, true);
check('loop guard refuses an incoming hop', $r === ['status' => 508, 'body' => ['ok' => false, 'error' => 'federation.loopDetected']] && !$fetched);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
