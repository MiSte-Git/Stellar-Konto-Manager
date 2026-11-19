<?php
// Logo-Proxy (api/assetLogo.php) gegen die gemeinsame Fixture test/assets/asset-logo.json: Bilderkennung an
// den ersten Bytes, Groesse aus dem Bildkopf, image-URL aus der stellar.toml, ganzer Ablauf mit Stubs, Header,
// SSRF-Schutz beim Bildabruf. Pendant: test/assetLogo.test.js. Rate-Limit und Route: test/rateLimitAreas.test.php
// und test/rateLimitRoutes.test.php.
//
// Run with: php test/assetLogo.test.php

declare(strict_types=1);

require __DIR__ . '/../api/assetLogo.php';
require __DIR__ . '/../api/assetIdentity.php';

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n";
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n";
    }
}

$fx = json_decode((string)file_get_contents(__DIR__ . '/assets/asset-logo.json'), true);

check('Grenzwerte wie in der Fixture', ASSET_LOGO_MAX_BYTES === $fx['limits']['maxBytes']
    && ASSET_LOGO_MAX_DIMENSION === $fx['limits']['maxDimension']
    && ASSET_LOGO_MAX_URL_LENGTH === $fx['limits']['maxUrlLength']
    && ASSET_LOGO_CACHE_SECONDS === $fx['limits']['cacheSeconds']
    && ASSET_LOGO_ERROR_CACHE_SECONDS === $fx['limits']['errorCacheSeconds']);
check('Fehlerstatus wie in der Fixture', ASSET_LOGO_ERROR_STATUS === $fx['errors']);

foreach ($fx['images'] as $c) {
    $got = asset_logo_sniff((string)hex2bin($c['hex']));
    check("Bild: {$c['name']}", $got === $c['expect']);
    if ($got !== $c['expect']) echo '   erhalten: ' . json_encode($got) . "\n";
}

$png = (string)hex2bin($fx['images'][0]['hex']);
$exact = $png . str_repeat("\0", $fx['limits']['maxBytes'] - strlen($png));
check('Bild: genau maxBytes geht', asset_logo_sniff($exact)['ok'] === true);
check('Bild: ueber maxBytes ist tooLarge', asset_logo_sniff($exact . "\0") === ['ok' => false, 'error' => 'tooLarge']);

foreach ($fx['imageUrls'] as $c) {
    $got = asset_logo_url_from_image($c['image']);
    check('image-URL: ' . json_encode($c['image'], JSON_UNESCAPED_UNICODE), $got === $c['expect']);
}
$base = 'https://example.com/';
$ok = $base . str_repeat('a', $fx['limits']['maxUrlLength'] - strlen($base));
check('image-URL: Laenge bis maxUrlLength', asset_logo_url_from_image($ok) === $ok && asset_logo_url_from_image($ok . 'a') === null);

$asset = ['code' => $fx['code'], 'issuer' => $fx['issuer']];
foreach ($fx['flows'] as $flow) {
    $requested = [];
    $loadAccount = function (string $id) use ($flow, $fx): array {
        if ($id !== $fx['issuer']) throw new RuntimeException('falscher Issuer');
        if (!empty($flow['horizonError'])) throw new RuntimeException('Horizon down');
        return ['account_id' => $id, 'home_domain' => $flow['homeDomain']];
    };
    $fetchToml = function (string $url) use ($flow, $fx): string {
        if ($url !== 'https://' . $flow['homeDomain'] . '/.well-known/stellar.toml') throw new RuntimeException('falsche TOML-URL');
        if (!empty($flow['tomlError'])) throw new RuntimeException('HTTP 500');
        return str_replace('__ISSUER__', $fx['issuer'], (string)$flow['toml']);
    };
    $fetchImage = function (string $url) use ($flow, &$requested): string {
        $requested[] = $url;
        $err = $flow['imageError'] ?? null;
        if ($err === 'tooLarge') throw new RuntimeException('ssrf_blocked_response_too_large');
        if ($err === 'network') throw new RuntimeException('connection_error');
        if (!array_key_exists($url, $flow['images'])) throw new RuntimeException('HTTP 404');
        return (string)hex2bin($flow['images'][$url]);
    };
    $result = asset_logo_fetch($asset, $loadAccount, $fetchToml, $fetchImage);
    $e = $flow['expect'];
    if ($e['status'] === 200) {
        $okFlow = $result['ok'] === true && $result['mime'] === $e['mime'] && $result['width'] === $e['width']
            && $result['height'] === $e['height'] && $result['bytes'] === hex2bin($flow['images'][$e['requested'][0]]);
    } else {
        $okFlow = $result === ['ok' => false, 'error' => $e['error'], 'status' => $e['status']];
    }
    check("Ablauf: {$flow['name']}", $okFlow && $requested === $e['requested']);
    if ($e['status'] !== 200) {
        $want = in_array($e['error'], $fx['transientErrors'], true) ? $fx['headers']['transientError'] : $fx['headers']['error'];
        $got = asset_logo_error_headers((string)($result['error'] ?? ''));
        ksort($want);
        ksort($got);
        check("Ablauf: {$flow['name']}: Header der Gruppe", $got === $want);
    }
    if (!$okFlow) echo '   erhalten: ' . json_encode(array_diff_key($result, ['bytes' => 1])) . "\n";
}

$sniffed = asset_logo_sniff($png);
$headers = asset_logo_success_headers($sniffed + ['bytes' => $png]);
$expected = $fx['headers']['success'] + [
    'Content-Type' => 'image/png',
    'Content-Length' => (string)strlen($png),
    'Content-Disposition' => 'inline; filename="logo.png"',
];
ksort($headers);
ksort($expected);
check('Header: Erfolg wie in der Fixture, Typ aus der Erkennung', $headers === $expected);
// Voruebergehend (no-store) gegen dauerhaft (eine Stunde), mit Gegenprobe je Gruppe.
$permanentErrors = ['noHomeDomain', 'notListed', 'noImage', 'tooLarge', 'unsupportedType', 'invalidImage', 'dimensionsTooLarge'];
$sorted = function (array $a): array { ksort($a); return $a; };
$allErrors = array_keys($fx['errors']);
$groups = array_merge($fx['transientErrors'], $permanentErrors);
sort($allErrors);
sort($groups);
check('Fehlergruppen: Liste wie in der Fixture', ASSET_LOGO_TRANSIENT_ERRORS === $fx['transientErrors']
    && $fx['transientErrors'] === ['issuerUnavailable', 'tomlUnavailable', 'fetchFailed']);
check('Fehlergruppen: alle Fehler in genau zwei Gruppen', $groups === $allErrors
    && array_intersect($fx['transientErrors'], $permanentErrors) === []);
foreach ($fx['transientErrors'] as $error) {
    $h = asset_logo_error_headers($error);
    check("Fehler-Header voruebergehend: {$error} -> no-store", $sorted($h) === $sorted($fx['headers']['transientError']));
    check("Fehler-Header voruebergehend: {$error} Gegenprobe kein max-age", strpos($h['Cache-Control'], 'max-age') === false);
}
foreach ($permanentErrors as $error) {
    $h = asset_logo_error_headers($error);
    check("Fehler-Header dauerhaft: {$error} -> max-age 3600", $sorted($h) === $sorted($fx['headers']['error'])
        && $h['Cache-Control'] === 'public, max-age=' . $fx['limits']['errorCacheSeconds']);
    check("Fehler-Header dauerhaft: {$error} Gegenprobe nicht no-store", $h['Cache-Control'] !== 'no-store');
}
check('Fehler-Header: unbekannter Fehler gilt als dauerhaft', $sorted(asset_logo_error_headers('irgendwas')) === $sorted($fx['headers']['error']));
$tradeSrc = (string)file_get_contents(__DIR__ . '/../api/trade.php');
check('trade.php reicht den Fehler an asset_logo_error_headers weiter',
    strpos($tradeSrc, "asset_logo_error_headers((string)\$result['error'])") !== false && strpos($tradeSrc, 'asset_logo_error_headers()') === false);

function throwsMessage(callable $fn): string {
    try {
        $fn();
        return '';
    } catch (Throwable $e) {
        return $e->getMessage();
    }
}
check('Bildabruf: http wird abgelehnt', throwsMessage(fn() => asset_logo_fetch_image('http://example.com/logo.png')) === 'ssrf_blocked_scheme');
check('Bildabruf: Loopback wird abgelehnt', throwsMessage(fn() => asset_logo_fetch_image('https://127.0.0.1/logo.png')) === 'ssrf_blocked_ip');
check('Bildabruf: IPv4-mapped Metadaten-Adresse wird abgelehnt',
    throwsMessage(fn() => asset_logo_fetch_image('https://[::ffff:169.254.169.254]/logo.png')) === 'ssrf_blocked_ip');

// Abbruch beim Lesen: fetch_url bekommt maxBytes = ASSET_LOGO_MAX_BYTES und bricht in CURLOPT_WRITEFUNCTION ab
// (siehe test/ssrfGuard.test.php fuer fetch_url selbst). Hier: die Grenze wird wirklich uebergeben.
$src = (string)file_get_contents(__DIR__ . '/../api/assetLogo.php');
check('Bildabruf: fetch_url mit httpsOnly, maxBytes ASSET_LOGO_MAX_BYTES und Hop-Header',
    preg_match("/fetch_url\\(\\\$url, '[^']+', ASSET_LOGO_FETCH_TIMEOUT_SECONDS, \\[\\s*'httpsOnly' => true,\\s*'maxBytes' => ASSET_LOGO_MAX_BYTES,\\s*'headers' => \\[ASSET_LOGO_HOP_HEADER \\. ': 1'\\],\\s*\\]\\)/", $src) === 1);

// --- Review LP-1, LP-2, LP-3, LP-6 ---
check('Fristen wie in der Fixture', SKM_JSON_FETCH_TIMEOUT_SECONDS === $fx['limits']['horizonTimeoutSeconds']
    && SKM_TOML_FETCH_TIMEOUT_SECONDS === $fx['limits']['tomlTimeoutSeconds']
    && ASSET_LOGO_FETCH_TIMEOUT_SECONDS === $fx['limits']['imageTimeoutSeconds']);
check('Hop-Header wie in der Fixture', ASSET_LOGO_HOP_HEADER === $fx['hopHeader']);

foreach ($fx['refusals'] as $c) {
    $got = asset_logo_request_refusal($c['hop'], $c['dest']);
    $want = $c['expect'] === null ? null : ['status' => 404, 'error' => $c['expect']];
    check('Ablehnung: hop=' . json_encode($c['hop']) . ' dest=' . json_encode($c['dest']), $got === $want);
}

$subIssuer = function ($v) use (&$subIssuer, $fx) {
    if (is_array($v)) return array_map($subIssuer, $v);
    return is_string($v) ? str_replace('__ISSUER__', $fx['issuer'], $v) : $v;
};
foreach ($fx['identityInputs'] as $c) {
    $got = asset_identity_from_input($subIssuer($c['code']), $subIssuer($c['issuer']));
    $want = $c['expect'] === 'ok'
        ? ['ok' => true, 'code' => 'USDX', 'issuer' => $fx['issuer']]
        : ['ok' => false, 'error' => $c['expect']];
    check('Eingang: code=' . json_encode($c['code']) . ' issuer=' . json_encode($c['issuer']), $got === $want);
}

check('Bildabruf und TOML-Abruf tragen den Hop-Header',
    strpos($src, "'headers' => [ASSET_LOGO_HOP_HEADER . ': 1']") !== false
    && strpos($tradeSrc, "fetch_text(\$url, [ASSET_LOGO_HOP_HEADER . ': 1'])") !== false);
check('trade.php: Ablehnung vor dem Rate-Limit',
    (bool)preg_match('/function asset_logo_route\(\): void \{\s*\$refusal = asset_logo_request_refusal\(\$_SERVER\[.HTTP_X_SKM_LOGO_HOP.\] \?\? null, \$_SERVER\[.HTTP_SEC_FETCH_DEST.\] \?\? null\);\s*if \(\$refusal !== null\) json_out\([^;]+;\s*\$retryAfter = asset_logo_rate_limit_check_and_record/', $tradeSrc));
check('trade.php: Vary: Sec-Fetch-Dest beim Logo, angehaengt', strpos($tradeSrc, "header('Vary: Sec-Fetch-Dest', false);") !== false);
check('trade.php: normalize_asset_identity nutzt asset_identity_from_input',
    strpos($tradeSrc, "asset_identity_from_input(\$_GET['code'] ?? null, \$_GET['issuer'] ?? null)") !== false);

// --- Review LP-4: dieselbe stellar.toml in Node und PHP gleich gelesen (tomlCases) ---
$subDeep = function ($v) use (&$subDeep, $fx) {
    if (is_array($v)) return array_map($subDeep, $v);
    return is_string($v) ? str_replace('__ISSUER__', $fx['issuer'], $v) : $v;
};
// Vergleich auf JSON-Ebene wie die Antwort von /facts: {} und [] bleiben unterschieden.
$jsonCanon = function ($v) use (&$jsonCanon) {
    if ($v instanceof stdClass) $v = (array)$v;
    if (!is_array($v)) return $v;
    if (array_is_list($v)) return array_map($jsonCanon, $v);
    ksort($v);
    return array_map($jsonCanon, $v);
};
$pngBytes = (string)hex2bin($fx['images'][0]['hex']);
$probeCount = 0;
foreach ($fx['tomlCases'] as $c) {
    if (!empty($c['probe'])) $probeCount++;
    $text = $subDeep(isset($c['tomlHex']) ? (string)hex2bin($c['tomlHex']) : $c['toml']);
    try {
        $got = json_decode((string)json_encode(skm_currencies_for_json(parse_currency_sections_from_toml($text))), false);
        $want = json_decode((string)json_encode($subDeep($c['expect']['currencies'] ?? null)), false);
        $okParse = empty($c['expect']['invalid']) && $jsonCanon($got) === $jsonCanon($want)
            && json_encode($jsonCanon($got)) === json_encode($jsonCanon($want));
    } catch (RuntimeException $e) {
        $okParse = !empty($c['expect']['invalid']) && $e->getMessage() === 'toml_invalid_format';
    }
    $result = asset_logo_fetch($asset, fn() => ['home_domain' => 'example.com'], fn() => $text, fn() => $pngBytes);
    $okLogo = ($result['ok'] ? 'ok' : $result['error']) === $c['logo'];
    check("TOML: {$c['name']}", $okParse && $okLogo);
    if (!$okParse || !$okLogo) echo '   logo: ' . ($result['ok'] ? 'ok' : $result['error']) . "\n";
}
check('TOML: die Probefaelle aus dem Review sind dabei', $probeCount >= 15);
check('TOML: leerer Eintrag ergibt {} wie in Node', json_encode(skm_currencies_for_json(parse_currency_sections_from_toml("[[CURRENCIES]]\n"))) === '[{}]');
check('TOML: /facts nutzt skm_currency_matches und skm_currencies_for_json',
    strpos($tradeSrc, 'skm_currency_matches($currency, $asset)') !== false
    && strpos($tradeSrc, "'currencies' => skm_currencies_for_json(\$currencies)") !== false);
check('TOML: nur Text-Werte treffen', skm_currency_matches(['code' => 'USDX', 'issuer' => $fx['issuer']], $asset)
    && !skm_currency_matches(['code' => true, 'issuer' => $fx['issuer']], ['code' => '1', 'issuer' => $fx['issuer']])
    && !skm_currency_matches(['code' => 123, 'issuer' => $fx['issuer']], ['code' => '123', 'issuer' => $fx['issuer']]));

// --- Verschachtelung der stellar.toml (tomlDepthCases) ---
$buildToml = function (array $b) use ($subDeep): string {
    if (isset($b['text'])) return $subDeep($b['text']);
    return $subDeep($b['prefix'] . str_repeat($b['repeat'], $b['times']) . $b['middle']
        . ($b['suffix'] ?? str_repeat($b['suffixRepeat'], $b['times'])));
};
check('Verschachtelung: Grenzen wie in der Fixture', SKM_TOML_MAX_DEPTH === $fx['limits']['tomlMaxDepth']
    && SKM_TOML_MAX_STRUCTURE_DEPTH === $fx['limits']['tomlMaxStructureDepth']);
foreach ($fx['tomlDepthCases'] as $c) {
    $text = $buildToml($c['build']);
    $t0 = microtime(true);
    $result = asset_logo_fetch($asset, fn() => ['home_domain' => 'example.com'], fn() => $text, fn() => $pngBytes);
    $got = $result['ok'] ? 'ok' : $result['error'];
    $elapsed = microtime(true) - $t0;
    $ok = $got === $c['logo'] && $elapsed < 5;
    if (isset($c['withoutLimit'])) {
        // Gegenprobe ohne Grenze: der Fall ist sonst gueltig, abgelehnt wird er nur wegen der Grenze.
        $list = parse_currency_sections_from_toml($text, 100000, 100000);
        $found = 'notListed';
        foreach ($list as $e) if (($e['code'] ?? null) === 'USDX') $found = 'ok';
        $ok = $ok && $found === $c['withoutLimit'];
    }
    check("Verschachtelung: {$c['name']}", $ok);
    if (!$ok) echo "   erhalten: {$got}\n";
}
// JSON von /facts: Eintraege bis zur Strukturgrenze lassen sich schreiben (Standardtiefe 512 reichte nicht).
$deep = parse_currency_sections_from_toml($buildToml(['text' => "[[CURRENCIES]]\ncode = \"USDX\"\n[CURRENCIES." . implode('.', array_fill(0, 997, 'k')) . "]\n"]));
check('Verschachtelung: tiefer Eintrag laesst sich wie in json_out schreiben', json_encode(['toml' => ['currencies' => skm_currencies_for_json($deep)]], 0, 1100) !== false);
check('Verschachtelung: json_out schreibt mit Tiefe 1100', strpos($tradeSrc, 'echo json_encode($payload, 0, 1100);') !== false);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
