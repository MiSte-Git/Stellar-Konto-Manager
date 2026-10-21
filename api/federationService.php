<?php
// SEP-2 federation lookups done server-side (Backlog P1.2) - PHP twin of
// services/federationService.js. See there for why this runs on the backend
// and for the reverse lookup rules; both files must apply identical rules
// (test/federationService.test.js and test/federationService.test.php run
// the same cases against each).
//
// Split from api/federation.php (routing) so the tests can require it
// directly, same pattern as api/ssrfGuard.php / api/trade.php.
declare(strict_types=1);

require_once __DIR__ . '/ssrfGuard.php';

const FEDERATION_FETCH_TIMEOUT_SECONDS = 5;
const FEDERATION_MAX_TOML_BYTES = 256 * 1024;
const FEDERATION_MAX_RESPONSE_BYTES = 64 * 1024;
const FEDERATION_MAX_ADDRESS_LENGTH = 256;
const FEDERATION_MAX_NAME_LENGTH = 128;
const FEDERATION_MAX_HOME_DOMAIN_LENGTH = 32;
const FEDERATION_MAX_SERVER_URL_LENGTH = 512;
const FEDERATION_HOSTNAME_RE = '/^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/';
// Printable ASCII without '*' and '>' (see NAME_RE in the JS twin: blocks
// Unicode lookalikes / bidi tricks in displayed names, keeps parity exact).
const FEDERATION_NAME_RE = '/^[\x21-\x29\x2b-\x3d\x3f-\x7e]+$/';
const FEDERATION_PRINTABLE_ASCII_RE = '/^[\x21-\x7e]+$/';
// Outbound marker, incoming requests carrying it are refused (loop guard,
// see HOP_HEADER in the JS twin).
const FEDERATION_HOP_HEADER = 'X-SKM-Federation-Hop';
const FEDERATION_MEMO_TYPES = ['text', 'id', 'hash'];

final class FederationException extends RuntimeException {
    public string $federationCode; // invalidInput | notFound | unavailable
    public function __construct(string $code) {
        parent::__construct('federation.' . $code);
        $this->federationCode = $code;
    }
}

function federation_crc16_xmodem(string $data): int {
    $crc = 0x0000;
    $len = strlen($data);
    for ($i = 0; $i < $len; $i++) {
        $crc ^= ord($data[$i]) << 8;
        for ($bit = 0; $bit < 8; $bit++) {
            $crc = ($crc & 0x8000) ? (($crc << 1) ^ 0x1021) : ($crc << 1);
            $crc &= 0xFFFF;
        }
    }
    return $crc;
}

// G... strkey with version byte and CRC16 checksum, like
// StrKey.isValidEd25519PublicKey() in the JS SDK.
function federation_is_valid_account_id($id): bool {
    if (!is_string($id) || !preg_match('/^G[A-Z2-7]{55}$/', $id)) return false;
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    for ($i = 0; $i < 56; $i++) {
        $bits .= str_pad(decbin(strpos($alphabet, $id[$i])), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $byte) $bytes .= chr(bindec($byte));
    if (strlen($bytes) !== 35 || ord($bytes[0]) !== (6 << 3)) return false;
    $checksum = ord($bytes[33]) | (ord($bytes[34]) << 8); // little-endian
    return federation_crc16_xmodem(substr($bytes, 0, 33)) === $checksum;
}

function federation_normalize_domain($raw, int $maxLength = 253): ?string {
    if (!is_string($raw)) return null;
    $trimmed = trim($raw);
    if (!preg_match(FEDERATION_PRINTABLE_ASCII_RE, $trimmed)) return null;
    $domain = strtolower($trimmed);
    if (strlen($domain) > $maxLength || !preg_match(FEDERATION_HOSTNAME_RE, $domain)) return null;
    return $domain;
}

function federation_parse_address($raw): ?array {
    if (!is_string($raw)) return null;
    $value = trim($raw);
    if ($value === '' || strlen($value) > FEDERATION_MAX_ADDRESS_LENGTH || !preg_match(FEDERATION_PRINTABLE_ASCII_RE, $value)) return null;
    $star = strpos($value, '*');
    if ($star === false || $star === 0 || $star !== strrpos($value, '*')) return null;
    $name = substr($value, 0, $star);
    $domain = federation_normalize_domain(substr($value, $star + 1));
    if ($domain === null || strlen($name) > FEDERATION_MAX_NAME_LENGTH) return null;
    if (preg_match(FEDERATION_NAME_RE, $name) !== 1) return null;
    return ['name' => $name, 'domain' => $domain, 'address' => $name . '*' . $domain];
}

function federation_toml_url(string $domain): string {
    return 'https://' . $domain . '/.well-known/stellar.toml';
}

function federation_extract_server(string $tomlText): ?string {
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $tomlText) ?? '';
    if (preg_match('/^\s*<(!doctype|html)/i', $text)) return null;
    foreach (preg_split('/\r?\n/', $text) ?: [] as $rawLine) {
        $line = trim($rawLine);
        if ($line === '' || $line[0] === '#') continue;
        if ($line[0] === '[') break;
        if (preg_match('/^FEDERATION_SERVER\s*=\s*(?:"([^"\\\\]*)"|\'([^\']*)\')\s*(?:#.*)?$/', $line, $m)) {
            return ($m[1] ?? '') !== '' ? $m[1] : ($m[2] ?? '');
        }
    }
    return null;
}

// https on port 443 only, printable ASCII, no credentials/query/fragment.
function federation_validate_server_url($raw): ?string {
    if (!is_string($raw)) return null;
    $value = trim($raw);
    if ($value === '' || strlen($value) > FEDERATION_MAX_SERVER_URL_LENGTH || !preg_match(FEDERATION_PRINTABLE_ASCII_RE, $value)) return null;
    if (strpbrk($value, '?#\\') !== false) return null;
    $parts = parse_url($value);
    if ($parts === false || strtolower((string)($parts['scheme'] ?? '')) !== 'https') return null;
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) return null;
    if (federation_normalize_domain((string)($parts['host'] ?? '')) === null) return null;
    return $value;
}

// Default fetcher: SSRF-safe (ssrfGuard.php), https only, no redirects.
function federation_default_fetch(string $url, string $accept, int $maxBytes): string {
    return fetch_url($url, $accept, FEDERATION_FETCH_TIMEOUT_SECONDS, [
        'httpsOnly' => true,
        'maxRedirects' => 0,
        'maxBytes' => $maxBytes,
        'headers' => [FEDERATION_HOP_HEADER . ': 1'],
    ]);
}

function federation_load_server(string $domain, callable $fetch): string {
    try {
        $toml = $fetch(federation_toml_url($domain), 'text/plain, application/toml, */*', FEDERATION_MAX_TOML_BYTES);
    } catch (Throwable $e) {
        throw new FederationException($e->getMessage() === 'HTTP 404' ? 'notFound' : 'unavailable');
    }
    $server = federation_validate_server_url(federation_extract_server((string)$toml));
    if ($server === null) throw new FederationException('notFound');
    return $server;
}

function federation_query(string $serverUrl, string $q, string $type, callable $fetch): array {
    // $serverUrl has no query (federation_validate_server_url refuses one).
    try {
        $text = $fetch($serverUrl . '?' . http_build_query(['q' => $q, 'type' => $type]), 'application/json', FEDERATION_MAX_RESPONSE_BYTES);
    } catch (Throwable $e) {
        throw new FederationException($e->getMessage() === 'HTTP 404' ? 'notFound' : 'unavailable');
    }
    if (!is_object(json_decode((string)$text))) throw new FederationException('unavailable');
    $data = json_decode((string)$text, true);
    return is_array($data) ? $data : [];
}

function federation_is_valid_memo(string $type, $memo): bool {
    if (!is_string($memo) || $memo === '') return false;
    if ($type === 'text') return strlen($memo) <= 28;
    if ($type === 'id') {
        if (!preg_match('/^\d{1,20}$/', $memo)) return false;
        $trimmed = ltrim($memo, '0');
        if ($trimmed === '') return true;
        return strlen($trimmed) < 20 || strcmp($trimmed, '18446744073709551615') <= 0;
    }
    if ($type === 'hash') {
        if (!preg_match('/^[A-Za-z0-9+\/]{43}=$/', $memo)) return false;
        $decoded = base64_decode($memo, true);
        return $decoded !== false && strlen($decoded) === 32;
    }
    return false;
}

function federation_is_blank($value): bool {
    return $value === null || $value === '';
}

// A malformed memo rejects the whole record (see the JS twin).
function federation_validate_name_record(array $data): ?array {
    $accountId = $data['account_id'] ?? null;
    if (!federation_is_valid_account_id($accountId)) return null;
    $record = ['account_id' => $accountId];
    $hasType = !federation_is_blank($data['memo_type'] ?? null);
    $hasMemo = !federation_is_blank($data['memo'] ?? null);
    if (!$hasType && !$hasMemo) return $record;
    if (!$hasType || !$hasMemo || !in_array($data['memo_type'], FEDERATION_MEMO_TYPES, true)) return null;
    $memo = $data['memo'];
    // JSON numbers: integral values up to 2^53-1 (1, 1.0, 1e3), like the JS
    // twin's Number.isSafeInteger() after JSON.parse.
    if ($data['memo_type'] === 'id' && (is_int($memo) || is_float($memo))
        && $memo >= 0 && $memo <= 9007199254740991 && floor((float)$memo) == $memo) {
        $memo = (string)(int)$memo;
    }
    if (!federation_is_valid_memo($data['memo_type'], $memo)) return null;
    $record['memo_type'] = $data['memo_type'];
    $record['memo'] = $memo;
    return $record;
}

function federation_resolve_name($rawAddress, ?callable $fetch = null): array {
    $fetch = $fetch ?? 'federation_default_fetch';
    $parsed = federation_parse_address($rawAddress);
    if ($parsed === null) throw new FederationException('invalidInput');
    $server = federation_load_server($parsed['domain'], $fetch);
    $record = federation_validate_name_record(federation_query($server, $parsed['address'], 'name', $fetch));
    if ($record === null) throw new FederationException('unavailable');
    return array_merge(['stellar_address' => $parsed['address']], $record);
}

// $loadHomeDomain: callable(string $accountId): string, from Horizon.
function federation_reverse_lookup($accountId, callable $loadHomeDomain, ?callable $fetch = null): array {
    $fetch = $fetch ?? 'federation_default_fetch';
    $id = is_string($accountId) ? trim($accountId) : '';
    if (!federation_is_valid_account_id($id)) throw new FederationException('invalidInput');
    $none = ['found' => false];
    try {
        $homeDomain = federation_normalize_domain($loadHomeDomain($id), FEDERATION_MAX_HOME_DOMAIN_LENGTH);
        if ($homeDomain === null) return $none;
        $server = federation_load_server($homeDomain, $fetch);

        $reverse = federation_query($server, $id, 'id', $fetch);
        if (array_key_exists('account_id', $reverse) && $reverse['account_id'] !== $id) return $none;
        $parsed = federation_parse_address($reverse['stellar_address'] ?? null);
        if ($parsed === null || $parsed['domain'] !== $homeDomain) return $none;

        // Cross-check: forward resolution must point back to this account.
        $forward = federation_validate_name_record(federation_query($server, $parsed['address'], 'name', $fetch));
        if ($forward === null || $forward['account_id'] !== $id) return $none;

        return ['found' => true, 'stellar_address' => $parsed['address'], 'domain' => $homeDomain];
    } catch (Throwable $e) {
        return $none;
    }
}

// Returns ['status' => int, 'body' => array]; same contract as
// handleFederationRequest() in services/federationService.js.
function federation_handle_request(array $query, callable $loadHomeDomain, ?callable $fetch = null, bool $incomingHop = false): array {
    $statusByCode = ['invalidInput' => 400, 'notFound' => 404, 'loopDetected' => 508, 'unavailable' => 502];
    if ($incomingHop) {
        return ['status' => 508, 'body' => ['ok' => false, 'error' => 'federation.loopDetected']];
    }
    $type = is_string($query['type'] ?? null) ? $query['type'] : '';
    $q = is_string($query['q'] ?? null) ? $query['q'] : '';
    try {
        if ($type === 'name') {
            return ['status' => 200, 'body' => array_merge(['ok' => true], federation_resolve_name($q, $fetch))];
        }
        if ($type === 'id') {
            return ['status' => 200, 'body' => array_merge(['ok' => true], federation_reverse_lookup($q, $loadHomeDomain, $fetch))];
        }
        throw new FederationException('invalidInput');
    } catch (Throwable $e) {
        $code = $e instanceof FederationException ? $e->federationCode : 'unavailable';
        return ['status' => $statusByCode[$code] ?? 502, 'body' => ['ok' => false, 'error' => 'federation.' . $code]];
    }
}

// Per-IP rate limit, file-backed like bugReportRateLimitCheckAndRecord()
// (api/bugreportGuard.php). Same budget as the Node route (30 per minute):
// each lookup fans out to up to three outbound requests.
const FEDERATION_RATE_LIMIT_MAX = 30;
const FEDERATION_RATE_LIMIT_WINDOW_SECONDS = 60;

function federation_rate_limit_path(): string {
    $override = getenv('FEDERATION_RATE_LIMIT_PATH');
    return $override !== false && $override !== '' ? $override : __DIR__ . '/data/federation_rate_limit.json';
}

// IPv6 is keyed per /64 (one end-user allocation), like express-rate-limit
// on the Node side; otherwise a single /64 would be unlimited identities.
function federation_rate_limit_key(string $ip): string {
    $packed = @inet_pton($ip);
    // IPv4-mapped (::ffff:a.b.c.d): key by the embedded IPv4 address, otherwise
    // every IPv4 client behind a dual-stack socket would share one /64 bucket.
    if ($packed !== false && strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        return inet_ntop(substr($packed, 12));
    }
    if ($packed !== false && strlen($packed) === 16) {
        return 'v6:' . bin2hex(substr($packed, 0, 8)) . '::/64';
    }
    return $ip;
}

const FEDERATION_RATE_LIMIT_MAX_ENTRIES = 5000;

// Records one request for $ip; returns seconds to wait if over budget, else 0.
function federation_rate_limit_check_and_record(string $ip): int {
    $ip = federation_rate_limit_key($ip);
    $file = federation_rate_limit_path();
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $lockHandle = @fopen($file . '.lock', 'c');
    if ($lockHandle === false) return 0; // fail open on the rate limiter itself
    flock($lockHandle, LOCK_EX);
    try {
        $data = [];
        if (file_exists($file)) {
            $raw = @file_get_contents($file);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) $data = $decoded;
        }
        $now = time();
        foreach ($data as $key => $entry) {
            if (($now - (int)($entry['windowStart'] ?? 0)) > FEDERATION_RATE_LIMIT_WINDOW_SECONDS) unset($data[$key]);
        }
        // Cap the file size: when full, the oldest windows are dropped first.
        if (!isset($data[$ip]) && count($data) >= FEDERATION_RATE_LIMIT_MAX_ENTRIES) {
            uasort($data, fn($a, $b) => (int)($a['windowStart'] ?? 0) <=> (int)($b['windowStart'] ?? 0));
            $data = array_slice($data, count($data) - FEDERATION_RATE_LIMIT_MAX_ENTRIES + 1, null, true);
        }
        $entry = $data[$ip] ?? ['count' => 0, 'windowStart' => $now];
        $entry['count'] = (int)$entry['count'] + 1;
        $data[$ip] = $entry;
        @file_put_contents($file, json_encode($data));
        if ($entry['count'] > FEDERATION_RATE_LIMIT_MAX) {
            return max(FEDERATION_RATE_LIMIT_WINDOW_SECONDS - ($now - (int)$entry['windowStart']), 1);
        }
        return 0;
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}
