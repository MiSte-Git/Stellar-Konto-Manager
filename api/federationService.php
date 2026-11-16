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
require_once __DIR__ . '/addressKind.php';
require_once __DIR__ . '/rateLimit.php';

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
    public string $federationCode; // invalidInput | notFound | contractAddress | unavailable
    public function __construct(string $code) {
        parent::__construct('federation.' . $code);
        $this->federationCode = $code;
    }
}

// G... strkey with version byte and CRC16 checksum, like
// StrKey.isValidEd25519PublicKey() in the JS SDK. Regel in api/addressKind.php.
function federation_is_valid_account_id($id): bool {
    return skm_is_classic_account($id);
}

// C-/W-Adressen (Contract, muxed Contract seit Protocol 30 / CAP-84) sind fuer
// klassische Zahlungen kein gueltiges Ziel. Beide mit Checksumme wie
// StrKey.isValidContract() / StrKey.isValidMuxedContract() (W: 32 Byte
// Contract-ID + 8 Byte Mux-ID). Gleiche Regel wie isContractAddressId() im JS-Zwilling,
// beide ueber addressKind (api/addressKind.php, services/addressKind.js).
function federation_is_contract_address($id): bool {
    return skm_is_contract_address($id);
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
    $data = federation_query($server, $parsed['address'], 'name', $fetch);
    if (federation_is_contract_address($data['account_id'] ?? null)) throw new FederationException('contractAddress');
    $record = federation_validate_name_record($data);
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
    $statusByCode = ['invalidInput' => 400, 'notFound' => 404, 'contractAddress' => 422, 'loopDetected' => 508, 'unavailable' => 502];
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

// Per-IP rate limit ueber den gemeinsamen Limiter api/rateLimit.php (IPv6 je /64,
// IPv4-mapped als IPv4, eigene Datei). Same budget as the Node route (30 per minute):
// each lookup fans out to up to three outbound requests.
const FEDERATION_RATE_LIMIT_MAX = 30;
const FEDERATION_RATE_LIMIT_WINDOW_SECONDS = 60;

function federation_rate_limit_path(): string {
    return rateLimitPath('FEDERATION_RATE_LIMIT_PATH', 'federation_rate_limit.json');
}

// Records one request for $ip; returns seconds to wait if over budget, else 0.
function federation_rate_limit_check_and_record(string $ip): int {
    return rateLimitCheckAndRecord(federation_rate_limit_path(), $ip, FEDERATION_RATE_LIMIT_MAX, FEDERATION_RATE_LIMIT_WINDOW_SECONDS);
}
