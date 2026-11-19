<?php
// api/trade.php
// Read-only trading helper API for shared hosting.
// Supports:
// - GET /api/trade/assets/search
// - GET /api/trade/assets/facts
// - GET /api/trade/assets/expert
// - GET /api/trade/assets/logo (api/assetLogo.php)

declare(strict_types=1);

require __DIR__ . '/cors.php';
require __DIR__ . '/ssrfGuard.php';
require_once __DIR__ . '/stellarNetworks.php';
require_once __DIR__ . '/addressKind.php';
require_once __DIR__ . '/stellarToml.php';
require_once __DIR__ . '/assetIdentity.php';
require_once __DIR__ . '/assetLogo.php';

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

// Review LP-6: nur lesende Routen. Andere Methoden wie in Node (nur app.get) 404 statt wie GET behandelt.
if (!in_array(strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')), ['GET', 'HEAD'], true)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'trade.notFound']);
    exit;
}

function json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    // Tiefe ueber dem Standard 512: Eintraege der stellar.toml duerfen bis SKM_TOML_MAX_STRUCTURE_DEPTH (1000)
    // Ebenen haben, wie in Node. Mit 512 lieferte json_encode false und die Antwort war leer.
    echo json_encode($payload, 0, 1100);
    exit;
}

function request_path(): string {
    $uri = (string)($_SERVER['REQUEST_URI'] ?? '');
    $path = parse_url($uri, PHP_URL_PATH);
    return is_string($path) ? $path : '';
}

function horizon_base_url(): string {
    return skm_horizon_url(skm_network_from_query($_GET['network'] ?? null));
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
    if ($issuer !== '' && !skm_is_classic_account($issuer)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'], 400);
    }

    return ['code' => $code, 'issuer' => $issuer, 'limit' => $limit];
}

function case_insensitive_code_variants(string $code): array {
    if ($code === '') return [''];
    return array_values(array_unique([$code, strtoupper($code), strtolower($code)]));
}

function normalize_asset_identity(): array {
    $asset = asset_identity_from_input($_GET['code'] ?? null, $_GET['issuer'] ?? null);
    if (!$asset['ok']) json_out(['ok' => false, 'error' => $asset['error']], 400);
    return ['code' => $asset['code'], 'issuer' => $asset['issuer']];
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
            if (looks_like_html($tomlText)) {
                throw new RuntimeException('toml_invalid_format');
            }
            $currencies = parse_currency_sections_from_toml($tomlText);
            // Asset codes are case-sensitive on Stellar (USDC and usdc are
            // different assets even for the same issuer), so this must not
            // upcase either side - a differently-cased fake would otherwise
            // be confirmed as "listed in the issuer's stellar.toml".
            $matches = array_values(array_filter($currencies, fn($currency): bool => skm_currency_matches($currency, $asset)));
            $facts['toml'] = [
                'status' => 'loaded',
                'url' => $tomlUrl,
                'currencies' => skm_currencies_for_json($currencies),
                'matches' => skm_currencies_for_json($matches),
                'error' => '',
            ];
            json_out($facts);
        } catch (Throwable $e) {
            $facts['toml'] = [
                'status' => 'failed',
                'url' => $tomlUrl,
                'currencies' => [],
                'matches' => [],
                'error' => classify_toml_error($e->getMessage() ?: 'fetchFailed'),
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
    if ($issuer === '' || !skm_is_classic_account($issuer)) {
        json_out(['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'], 400);
    }
    $entry = ['issuer' => $issuer, 'status' => 'notChecked', 'name' => '', 'domain' => '', 'tags' => []];

    // The directory covers the public network; testnet issuers can never be
    // listed, so skip the upstream call entirely.
    if (skm_network_from_query($_GET['network'] ?? null) !== 'public') json_out($entry);

    try {
        $data = fetch_json('https://api.stellar.expert/explorer/directory/' . rawurlencode($issuer));
        // The directory endpoint answers "no entry" with HTTP 200 and an
        // empty object (verified live), not a 404 - only a body that carries
        // the account's own address is a real listing. Without this check
        // every unlisted (i.e. almost every) asset was mislabeled "listed".
        if (!isset($data['address'])) {
            json_out(array_merge($entry, ['status' => 'notListed']));
        }
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
        // 404 is also handled defensively in case the API's behavior differs
        // for some accounts/versions - not currently observed, but cheap to keep.
        $status = ($e->getMessage() === 'HTTP 404') ? 'notListed' : 'unavailable';
        json_out(array_merge($entry, ['status' => $status]));
    }
}

// GET /api/trade/assets/logo: Logo aus der stellar.toml des Issuers (api/assetLogo.php). Rate-Limit vor allen
// Pruefungen wie in Node. Ungueltige Eingabe, 429 und voruebergehende Fehler bleiben no-store, die uebrigen
// Fehler eine Stunde, ein Logo 24 Stunden. Header der Gegenseite werden nie weitergereicht.
function asset_logo_route(): void {
    $refusal = asset_logo_request_refusal($_SERVER['HTTP_X_SKM_LOGO_HOP'] ?? null, $_SERVER['HTTP_SEC_FETCH_DEST'] ?? null);
    if ($refusal !== null) json_out(['ok' => false, 'error' => 'assetLogo.' . $refusal['error']], $refusal['status']);
    $retryAfter = asset_logo_rate_limit_check_and_record((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        json_out(['ok' => false, 'error' => 'too_many_requests', 'retryAfter' => $retryAfter], 429);
    }
    $asset = normalize_asset_identity();
    $result = asset_logo_fetch(
        $asset,
        fn(string $issuer) => fetch_json(horizon_base_url() . '/accounts/' . rawurlencode($issuer)),
        fn(string $url) => fetch_text($url, [ASSET_LOGO_HOP_HEADER . ': 1']),
        fn(string $url) => asset_logo_fetch_image($url)
    );
    if (!$result['ok']) {
        foreach (asset_logo_error_headers((string)$result['error']) as $name => $value) header($name . ': ' . $value);
        json_out(['ok' => false, 'error' => 'assetLogo.' . $result['error']], (int)$result['status']);
    }
    foreach (asset_logo_success_headers($result) as $name => $value) header($name . ': ' . $value);
    // Ein gecachtes Logo darf nicht fuer einen Aufruf als Dokument dienen. false: Vary: Origin aus cors.php bleibt.
    header('Vary: Sec-Fetch-Dest', false);
    http_response_code(200);
    echo $result['bytes'];
    exit;
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
if (preg_match('#/api/trade/assets/logo$#', $path)) {
    asset_logo_route();
}

json_out(['ok' => false, 'error' => 'trade.notFound'], 404);
