<?php
// api/trade.php
// Read-only trading helper API for shared hosting.
// Supports:
// - GET /api/trade/assets/search
// - GET /api/trade/assets/facts
// - GET /api/trade/assets/expert

declare(strict_types=1);

require __DIR__ . '/cors.php';
require __DIR__ . '/ssrfGuard.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Shared allowlist in cors.php (finding #9) - this used to be its own,
// narrower copy missing skm.steei.de/PROD_ORIGIN that the other three
// api/*.php files already had, a real drift the centralization fixes.
apply_cors_headers(['GET', 'OPTIONS'], ['Content-Type']);

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const ASSET_CODE_RE = '/^[A-Za-z0-9]{1,12}$/';
const STELLAR_PUBLIC_KEY_RE = '/^G[A-Z2-7]{55}$/';

function json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function request_path(): string {
    $uri = (string)($_SERVER['REQUEST_URI'] ?? '');
    $path = parse_url($uri, PHP_URL_PATH);
    return is_string($path) ? $path : '';
}

function horizon_base_url(): string {
    $network = strtoupper((string)($_GET['network'] ?? 'PUBLIC'));
    return $network === 'TESTNET'
        ? 'https://horizon-testnet.stellar.org'
        : 'https://horizon.stellar.org';
}

function normalize_asset_search_input(): array {
    $code = trim((string)($_GET['code'] ?? ''));
    $issuer = trim((string)($_GET['issuer'] ?? ''));
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 20)));

    if ($code === '' && $issuer === '') {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:queryMissing'], 400);
    }
    if ($code !== '' && !preg_match(ASSET_CODE_RE, $code)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:codeInvalid'], 400);
    }
    if ($issuer !== '' && !preg_match(STELLAR_PUBLIC_KEY_RE, $issuer)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'], 400);
    }

    return ['code' => $code, 'issuer' => $issuer, 'limit' => $limit];
}

function case_insensitive_code_variants(string $code): array {
    if ($code === '') return [''];
    return array_values(array_unique([$code, strtoupper($code), strtolower($code)]));
}

function normalize_asset_identity(): array {
    $code = trim((string)($_GET['code'] ?? ''));
    $issuer = trim((string)($_GET['issuer'] ?? ''));

    if ($code === '' || !preg_match(ASSET_CODE_RE, $code)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:codeInvalid'], 400);
    }
    if ($issuer === '' || !preg_match(STELLAR_PUBLIC_KEY_RE, $issuer)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'], 400);
    }

    return ['code' => $code, 'issuer' => $issuer];
}

function search_assets(): void {
    $query = normalize_asset_search_input();

    try {
        $records = [];
        $seen = [];
        foreach (case_insensitive_code_variants($query['code']) as $codeVariant) {
            $params = ['limit' => (string)$query['limit']];
            if ($codeVariant !== '') $params['asset_code'] = $codeVariant;
            if ($query['issuer'] !== '') $params['asset_issuer'] = $query['issuer'];
            $url = horizon_base_url() . '/assets?' . http_build_query($params);
            $data = fetch_json($url);
            $pageRecords = $data['_embedded']['records'] ?? [];
            if (!is_array($pageRecords)) continue;
            foreach ($pageRecords as $record) {
                if (!is_array($record)) continue;
                $key = (string)($record['asset_code'] ?? '') . ':' . (string)($record['asset_issuer'] ?? '');
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $records[] = $record;
            }
        }
        $items = [];
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!is_array($record)) continue;
                $items[] = [
                    'assetType' => $record['asset_type'] ?? '',
                    'asset_type' => $record['asset_type'] ?? '',
                    'assetCode' => $record['asset_code'] ?? '',
                    'asset_code' => $record['asset_code'] ?? '',
                    'assetIssuer' => $record['asset_issuer'] ?? '',
                    'asset_issuer' => $record['asset_issuer'] ?? '',
                    'amount' => $record['amount'] ?? '',
                    'totalAmount' => $record['amount'] ?? '',
                    'balances' => $record['balances'] ?? '',
                    'numAccounts' => $record['num_accounts'] ?? '',
                    'num_accounts' => $record['num_accounts'] ?? '',
                    'accounts' => $record['accounts'] ?? '',
                    'pagingToken' => $record['paging_token'] ?? '',
                    'paging_token' => $record['paging_token'] ?? '',
                    'claimableBalancesAmount' => $record['claimable_balances_amount'] ?? '',
                    'liquidityPoolsAmount' => $record['liquidity_pools_amount'] ?? '',
                    'contractsAmount' => $record['contracts_amount'] ?? '',
                ];
            }
        }
        json_out(['items' => $items]);
    } catch (Throwable $e) {
        json_out(['ok' => false, 'error' => 'assetSearch.failed:' . $e->getMessage()], 502);
    }
}

function normalize_home_domain(string $domain): string {
    $domain = trim($domain);
    $domain = preg_replace('/^https?:\/\//i', '', $domain) ?? $domain;
    $domain = preg_replace('/\/.*$/', '', $domain) ?? $domain;
    return $domain;
}

function strip_toml_comment(string $value): string {
    $quote = '';
    $escaped = false;
    $out = '';
    $chars = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    foreach ($chars as $char) {
        if ($escaped) {
            $out .= $char;
            $escaped = false;
            continue;
        }
        if ($quote === '"' && $char === '\\') {
            $out .= $char;
            $escaped = true;
            continue;
        }
        if ($char === '"' || $char === "'") {
            if ($quote === '') $quote = $char;
            elseif ($quote === $char) $quote = '';
            $out .= $char;
            continue;
        }
        if ($char === '#' && $quote === '') break;
        $out .= $char;
    }
    return trim($out);
}

function split_toml_array(string $value): array {
    $items = [];
    $quote = '';
    $escaped = false;
    $current = '';
    $chars = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    foreach ($chars as $char) {
        if ($escaped) {
            $current .= $char;
            $escaped = false;
            continue;
        }
        if ($quote === '"' && $char === '\\') {
            $current .= $char;
            $escaped = true;
            continue;
        }
        if ($char === '"' || $char === "'") {
            if ($quote === '') $quote = $char;
            elseif ($quote === $char) $quote = '';
            $current .= $char;
            continue;
        }
        if ($char === ',' && $quote === '') {
            $items[] = trim($current);
            $current = '';
            continue;
        }
        $current .= $char;
    }
    if (trim($current) !== '') $items[] = trim($current);
    return $items;
}

function parse_toml_value(string $value) {
    $trimmed = strip_toml_comment($value);
    if ($trimmed === '') return '';
    if (substr($trimmed, 0, 1) === '[' && substr($trimmed, -1) === ']') {
        return array_map('parse_toml_value', split_toml_array(substr($trimmed, 1, -1)));
    }
    if (preg_match('/^([\'"])([\s\S]*)\1$/', $trimmed, $m)) {
        if ($m[1] === '"') {
            return str_replace(['\\n', '\\t', '\\"', '\\\\'], ["\n", "\t", '"', '\\'], $m[2]);
        }
        return $m[2];
    }
    if (preg_match('/^(true|false)$/i', $trimmed)) return strtolower($trimmed) === 'true';
    if (preg_match('/^[+-]?\d+(?:\.\d+)?$/', $trimmed)) return strpos($trimmed, '.') !== false ? (float)$trimmed : (int)$trimmed;
    return $trimmed;
}

function parse_currency_sections_from_toml(string $tomlText): array {
    $currencies = [];
    $currentIndex = null;
    foreach (preg_split('/\r?\n/', $tomlText) ?: [] as $rawLine) {
        $line = trim(strip_toml_comment((string)$rawLine));
        if ($line === '' || substr($line, 0, 1) === '#') continue;
        if (preg_match('/^\[\[\s*CURRENCIES\s*\]\]$/i', $line)) {
            $currencies[] = [];
            $currentIndex = count($currencies) - 1;
            continue;
        }
        if (preg_match('/^\[/', $line)) {
            $currentIndex = null;
            continue;
        }
        if ($currentIndex === null) continue;
        if (!preg_match('/^([A-Za-z0-9_]+)\s*=\s*(.+)$/', $line, $m)) continue;
        $currencies[$currentIndex][strtolower($m[1])] = parse_toml_value($m[2]);
    }
    return $currencies;
}

function simplify_issuer_account(array $account, string $issuer): array {
    $flags = is_array($account['flags'] ?? null) ? $account['flags'] : [];
    $signers = is_array($account['signers'] ?? null) ? $account['signers'] : [];
    $thresholds = is_array($account['thresholds'] ?? null) ? $account['thresholds'] : [];
    $issuerMasterWeight = null;
    $mappedSigners = [];
    foreach ($signers as $signer) {
        if (!is_array($signer)) continue;
        $key = (string)($signer['key'] ?? $signer['public_key'] ?? '');
        $weight = (int)($signer['weight'] ?? 0);
        if ($key === $issuer) $issuerMasterWeight = $weight;
        $mappedSigners[] = [
            'key' => $key,
            'public_key' => (string)($signer['public_key'] ?? $key),
            'weight' => $weight,
        ];
    }
    $homeDomain = (string)($account['home_domain'] ?? '');
    return [
        'accountId' => (string)($account['account_id'] ?? $account['id'] ?? $issuer),
        'homeDomain' => $homeDomain,
        'home_domain' => $homeDomain,
        'flags' => [
            'auth_required' => (bool)($flags['auth_required'] ?? false),
            'auth_revocable' => (bool)($flags['auth_revocable'] ?? false),
            'auth_immutable' => (bool)($flags['auth_immutable'] ?? false),
            'auth_clawback_enabled' => (bool)($flags['auth_clawback_enabled'] ?? false),
        ],
        'signers' => $mappedSigners,
        // Needed by the frontend to tell a genuinely locked issuer apart from
        // one where other signers could still control the account despite
        // master_weight === 0.
        'thresholds' => [
            'low_threshold' => (int)($thresholds['low_threshold'] ?? 0),
            'med_threshold' => (int)($thresholds['med_threshold'] ?? 0),
            'high_threshold' => (int)($thresholds['high_threshold'] ?? 0),
        ],
        'issuerMasterWeight' => $issuerMasterWeight,
    ];
}

function failed_asset_facts(array $asset, string $error): array {
    return [
        'assetCode' => $asset['code'],
        'assetIssuer' => $asset['issuer'],
        'issuerAccount' => null,
        'toml' => [
            'status' => 'failed',
            'url' => '',
            'currencies' => [],
            'matches' => [],
            'error' => $error,
        ],
        'error' => 'assetFacts.failed:' . $error,
        'ok' => false,
    ];
}

function asset_facts(): void {
    $asset = normalize_asset_identity();
    try {
        $account = fetch_json(horizon_base_url() . '/accounts/' . rawurlencode($asset['issuer']));
        $issuerAccount = simplify_issuer_account($account, $asset['issuer']);
        $domain = normalize_home_domain((string)($issuerAccount['homeDomain'] ?? ''));
        $tomlUrl = $domain !== '' ? 'https://' . $domain . '/.well-known/stellar.toml' : '';
        $facts = [
            'assetCode' => $asset['code'],
            'assetIssuer' => $asset['issuer'],
            'issuerAccount' => $issuerAccount,
            'toml' => [
                'status' => $tomlUrl !== '' ? 'loading' : 'noHomeDomain',
                'url' => $tomlUrl,
                'currencies' => [],
                'matches' => [],
                'error' => '',
            ],
        ];
        if ($tomlUrl === '') json_out($facts);

        try {
            $tomlText = fetch_text($tomlUrl);
            $currencies = parse_currency_sections_from_toml($tomlText);
            // Asset codes are case-sensitive on Stellar (USDC and usdc are
            // different assets even for the same issuer), so this must not
            // upcase either side - a differently-cased fake would otherwise
            // be confirmed as "listed in the issuer's stellar.toml".
            $matches = array_values(array_filter($currencies, function ($currency) use ($asset): bool {
                if (!is_array($currency)) return false;
                return (string)($currency['code'] ?? '') === $asset['code']
                    && (string)($currency['issuer'] ?? '') === $asset['issuer'];
            }));
            $facts['toml'] = [
                'status' => 'loaded',
                'url' => $tomlUrl,
                'currencies' => $currencies,
                'matches' => $matches,
                'error' => '',
            ];
            json_out($facts);
        } catch (Throwable $e) {
            $facts['toml'] = [
                'status' => 'failed',
                'url' => $tomlUrl,
                'currencies' => [],
                'matches' => [],
                'error' => $e->getMessage() ?: 'fetchFailed',
            ];
            json_out($facts);
        }
    } catch (Throwable $e) {
        json_out(failed_asset_facts($asset, $e->getMessage() ?: 'fetchFailed'), 502);
    }
}

// Third-party StellarExpert directory hint for an issuer account. Mirrors
// the Node implementation in services/tradeService.js: 404 from the API is
// the normal "not listed" answer, any other failure degrades to
// "unavailable" so an outage there never blocks the token display. A listing
// is a hint only - the frontend wording never presents it as proof of
// legitimacy, nor a missing listing as a scam indicator.
function expert_directory(): void {
    $issuer = trim((string)($_GET['issuer'] ?? ''));
    if ($issuer === '' || !preg_match(STELLAR_PUBLIC_KEY_RE, $issuer)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'], 400);
    }
    $entry = ['issuer' => $issuer, 'status' => 'notChecked', 'name' => '', 'domain' => '', 'tags' => []];

    // The directory covers the public network; testnet issuers can never be
    // listed, so skip the upstream call entirely.
    $network = strtoupper((string)($_GET['network'] ?? 'PUBLIC'));
    if ($network === 'TESTNET') json_out($entry);

    try {
        $data = fetch_json('https://api.stellar.expert/explorer/directory/' . rawurlencode($issuer));
        $tags = [];
        foreach ((array)($data['tags'] ?? []) as $tag) {
            $tag = strtolower(trim(ltrim((string)$tag, '#')));
            if ($tag !== '') $tags[] = $tag;
        }
        json_out(array_merge($entry, [
            'status' => 'listed',
            'name' => (string)($data['name'] ?? ''),
            'domain' => (string)($data['domain'] ?? ''),
            'tags' => $tags,
        ]));
    } catch (Throwable $e) {
        $status = ($e->getMessage() === 'HTTP 404') ? 'notListed' : 'unavailable';
        json_out(array_merge($entry, ['status' => $status]));
    }
}

$path = request_path();
if (preg_match('#/api/trade/assets/search$#', $path)) {
    search_assets();
}
if (preg_match('#/api/trade/assets/facts$#', $path)) {
    asset_facts();
}
if (preg_match('#/api/trade/assets/expert$#', $path)) {
    expert_directory();
}

json_out(['ok' => false, 'error' => 'trade.notFound'], 404);
