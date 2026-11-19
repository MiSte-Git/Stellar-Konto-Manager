<?php
// Logo-Proxy fuer GET /api/trade/assets/logo. Gegenstueck zu services/assetLogo.js, gemeinsame Faelle in
// test/assets/asset-logo.json. Die Route steht in api/trade.php (asset_logo_route).
//
// Ablauf: Issuer-Konto (Horizon) -> home_domain -> stellar.toml -> erster CURRENCIES-Eintrag mit genau diesem
// Code und Issuer -> dessen image (nur https) -> Bild ueber fetch_url (SSRF-Schutz) laden. Der Browser laedt
// nie direkt von der Domain des Issuers (CSP img-src bleibt 'self').
//
// Ausgeliefert wird PNG, JPEG oder WebP, erkannt an den ersten Bytes (nie am Content-Type oder an der Endung des
// Issuers), Breite und Hoehe aus dem Bildkopf, je hoechstens ASSET_LOGO_MAX_DIMENSION; dazu SVG nur nach der
// strengen Pruefung in api/svgLogo.php (Bytes unveraendert, ohne Abmessungspruefung). Hoechstens
// ASSET_LOGO_MAX_BYTES, der Abruf bricht beim Lesen ab (CURLOPT_WRITEFUNCTION in fetch_url). Die Antwort-Header
// setzen wir selbst, von der Gegenseite wird keiner uebernommen.
declare(strict_types=1);

require_once __DIR__ . '/ssrfGuard.php';
require_once __DIR__ . '/stellarToml.php';
require_once __DIR__ . '/rateLimit.php';
require_once __DIR__ . '/svgLogo.php';

const ASSET_LOGO_MAX_BYTES = 256 * 1024;
const ASSET_LOGO_MAX_DIMENSION = 1024;
const ASSET_LOGO_MAX_URL_LENGTH = 2048;
const ASSET_LOGO_CACHE_SECONDS = 86400;
const ASSET_LOGO_ERROR_CACHE_SECONDS = 3600;
const ASSET_LOGO_FETCH_TIMEOUT_SECONDS = 6;
// Review LP-2: Schleifenschutz, gleicher Name wie HOP_HEADER in services/assetLogo.js.
const ASSET_LOGO_HOP_HEADER = 'X-SKM-Logo-Hop';
const ASSET_LOGO_RATE_LIMIT_MAX = 60;
const ASSET_LOGO_RATE_LIMIT_WINDOW_SECONDS = 60;
const ASSET_LOGO_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
// Gleicher Ausdruck wie IMAGE_URL_RE in services/assetLogo.js.
const ASSET_LOGO_URL_RE = '~^https://(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::(\d{1,5}))?(?:[/?#][\x21-\x5b\x5d-\x7e]*)?$~i';

const ASSET_LOGO_ERROR_STATUS = [
    'noHomeDomain' => 404,
    'notListed' => 404,
    'noImage' => 404,
    'issuerUnavailable' => 502,
    'tomlUnavailable' => 502,
    'fetchFailed' => 502,
    'tooLarge' => 502,
    'unsupportedType' => 502,
    'invalidImage' => 502,
    'dimensionsTooLarge' => 502,
    'unsafeSvg' => 502,
];

const ASSET_LOGO_SVG_MIME = 'image/svg+xml; charset=utf-8';

// Jede Anfrage kann bis zu drei Abrufe nach aussen ausloesen (Horizon, stellar.toml, Bild): eigenes Budget.
function asset_logo_rate_limit_check_and_record(string $ip): int {
    return rateLimitCheckAndRecord(
        rateLimitPath('ASSET_LOGO_RATE_LIMIT_PATH', 'asset_logo_rate_limit.json'),
        $ip,
        ASSET_LOGO_RATE_LIMIT_MAX,
        ASSET_LOGO_RATE_LIMIT_WINDOW_SECONDS
    );
}

/** image-Feld aus dem CURRENCIES-Eintrag als URL, die wir abrufen duerfen, sonst null. */
function asset_logo_url_from_image($image): ?string {
    if (!is_string($image)) return null;
    // Nur ASCII-Leerraum wie asciiTrim in Node; anderer Leerraum faellt danach am Ausdruck durch.
    $url = trim($image);
    if ($url === '' || strlen($url) > ASSET_LOGO_MAX_URL_LENGTH) return null;
    if (!preg_match(ASSET_LOGO_URL_RE, $url, $m)) return null;
    if (isset($m[1]) && $m[1] !== '' && (int)$m[1] > 65535) return null;
    return $url;
}

function asset_logo_png_size(string $b): ?array {
    if (strlen($b) < 24 || unpack('N', substr($b, 8, 4))[1] !== 13 || substr($b, 12, 4) !== 'IHDR') return null;
    return ['width' => unpack('N', substr($b, 16, 4))[1], 'height' => unpack('N', substr($b, 20, 4))[1]];
}

function asset_logo_jpeg_size(string $b): ?array {
    $n = strlen($b);
    $i = 2;
    while (true) {
        if ($i >= $n || ord($b[$i]) !== 0xff) return null;
        while ($i < $n && ord($b[$i]) === 0xff) $i++; // Fuellbytes
        if ($i >= $n) return null;
        $marker = ord($b[$i]);
        $i++;
        if ($marker === 0x01 || ($marker >= 0xd0 && $marker <= 0xd7)) continue; // ohne Laenge
        if ($marker === 0xd8 || $marker === 0xd9 || $marker === 0xda) return null; // SOI, EOI, SOS vor einem SOF
        if ($i + 2 > $n) return null;
        $len = unpack('n', substr($b, $i, 2))[1];
        if ($len < 2) return null;
        // SOF0..SOF15 ausser DHT (C4), JPG (C8), DAC (CC): Laenge, Praezision, Hoehe, Breite.
        if ($marker >= 0xc0 && $marker <= 0xcf && $marker !== 0xc4 && $marker !== 0xc8 && $marker !== 0xcc) {
            if ($len < 7 || $i + 7 > $n) return null;
            return ['width' => unpack('n', substr($b, $i + 5, 2))[1], 'height' => unpack('n', substr($b, $i + 3, 2))[1]];
        }
        $i += $len;
    }
}

function asset_logo_u24le(string $b, int $i): int {
    return ord($b[$i]) | (ord($b[$i + 1]) << 8) | (ord($b[$i + 2]) << 16);
}

function asset_logo_webp_size(string $b): ?array {
    $n = strlen($b);
    $chunk = $n >= 16 ? substr($b, 12, 4) : '';
    if ($chunk === 'VP8 ') {
        if ($n < 30 || substr($b, 23, 3) !== "\x9d\x01\x2a") return null;
        return ['width' => unpack('v', substr($b, 26, 2))[1] & 0x3fff, 'height' => unpack('v', substr($b, 28, 2))[1] & 0x3fff];
    }
    if ($chunk === 'VP8L') {
        if ($n < 25 || ord($b[20]) !== 0x2f) return null;
        $bits = unpack('V', substr($b, 21, 4))[1];
        return ['width' => ($bits & 0x3fff) + 1, 'height' => (($bits >> 14) & 0x3fff) + 1];
    }
    if ($chunk === 'VP8X') {
        if ($n < 30) return null;
        return ['width' => asset_logo_u24le($b, 24) + 1, 'height' => asset_logo_u24le($b, 27) + 1];
    }
    return null;
}

/**
 * Bildtyp und Groesse aus den ersten Bytes. ['ok' => true, mime, ext, width, height] oder ['ok' => false, error].
 * Gleiche Fehler wie sniffLogoImage in services/assetLogo.js, auch fuer SVG (width/height null).
 * $svgDisabledRules nur fuer die Gegenprobe in den Tests.
 */
function asset_logo_sniff(string $b, array $svgDisabledRules = []): array {
    if (strlen($b) > ASSET_LOGO_MAX_BYTES) return ['ok' => false, 'error' => 'tooLarge'];
    if (strncmp($b, "\x89PNG\r\n\x1a\n", 8) === 0) {
        $type = ['mime' => 'image/png', 'ext' => 'png'];
        $size = asset_logo_png_size($b);
    } elseif (strncmp($b, "\xff\xd8\xff", 3) === 0) {
        $type = ['mime' => 'image/jpeg', 'ext' => 'jpg'];
        $size = asset_logo_jpeg_size($b);
    } elseif (strlen($b) >= 12 && substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP') {
        $type = ['mime' => 'image/webp', 'ext' => 'webp'];
        $size = asset_logo_webp_size($b);
    } else {
        // Weder PNG noch JPEG noch WebP: SVG nur nach strenger Pruefung (Anlass: Circle USDC/EURC liefern nur SVG).
        $svg = skm_check_svg_logo($b, $svgDisabledRules);
        if ($svg !== 'ok') return ['ok' => false, 'error' => $svg];
        return ['ok' => true, 'mime' => ASSET_LOGO_SVG_MIME, 'ext' => 'svg', 'width' => null, 'height' => null];
    }
    if ($size === null || $size['width'] < 1 || $size['height'] < 1) return ['ok' => false, 'error' => 'invalidImage'];
    if ($size['width'] > ASSET_LOGO_MAX_DIMENSION || $size['height'] > ASSET_LOGO_MAX_DIMENSION) {
        return ['ok' => false, 'error' => 'dimensionsTooLarge'];
    }
    return ['ok' => true] + $type + $size;
}

// Bild ueber den SSRF-Schutz: nur https (auch nach jeder Weiterleitung), Abbruch beim Lesen ab ASSET_LOGO_MAX_BYTES.
function asset_logo_fetch_image(string $url): string {
    return fetch_url($url, 'image/png, image/jpeg, image/webp, image/svg+xml', ASSET_LOGO_FETCH_TIMEOUT_SECONDS, [
        'httpsOnly' => true,
        'maxBytes' => ASSET_LOGO_MAX_BYTES,
        'headers' => [ASSET_LOGO_HOP_HEADER . ': 1'],
    ]);
}

/**
 * Review LP-2 und LP-3: Anfrage vor dem Rate-Limit ablehnen? Gleich wie logoRequestRefusal in
 * services/assetLogo.js. $hop = X-SKM-Logo-Hop, $dest = Sec-Fetch-Dest (null oder leer: nicht gesetzt).
 * Ergebnis: null oder ['status' => 404, 'error' => ...].
 */
function asset_logo_request_refusal($hop, $dest): ?array {
    if (is_string($hop) && $hop !== '') return ['status' => 404, 'error' => 'hopRefused'];
    if (is_string($dest) && $dest !== '' && $dest !== 'image') return ['status' => 404, 'error' => 'notImageRequest'];
    return null;
}

/**
 * Ganzer Ablauf fuer ein schon geprueftes Asset (['code' => ..., 'issuer' => ...]).
 * $loadAccount(issuer): array (Horizon-Konto), $fetchToml(url): string, $fetchImage(url): string; fuer Tests
 * austauschbar. Ergebnis: ['ok' => true, mime, ext, width, height, bytes] oder ['ok' => false, error, status].
 */
function asset_logo_fetch(array $asset, callable $loadAccount, callable $fetchToml, callable $fetchImage): array {
    $result = fn(string $error) => ['ok' => false, 'error' => $error, 'status' => ASSET_LOGO_ERROR_STATUS[$error]];

    try {
        $account = $loadAccount($asset['issuer']);
    } catch (Throwable $e) {
        return $result('issuerUnavailable');
    }
    $domain = normalize_home_domain(is_array($account) ? (string)($account['home_domain'] ?? '') : '');
    if ($domain === '') return $result('noHomeDomain');

    try {
        $text = $fetchToml('https://' . $domain . '/.well-known/stellar.toml');
        if (looks_like_html($text)) return $result('tomlUnavailable');
        $currencies = parse_currency_sections_from_toml($text);
    } catch (Throwable $e) {
        return $result('tomlUnavailable');
    }
    // Wie /facts: Code und Issuer exakt. Der erste Eintrag zaehlt, kein Rueckgriff auf spaetere.
    $match = null;
    foreach ($currencies as $currency) {
        if (skm_currency_matches($currency, $asset)) {
            $match = $currency;
            break;
        }
    }
    if ($match === null) return $result('notListed');
    $url = asset_logo_url_from_image($match['image'] ?? null);
    if ($url === null) return $result('noImage');

    try {
        $bytes = $fetchImage($url);
    } catch (Throwable $e) {
        return $result($e->getMessage() === 'ssrf_blocked_response_too_large' ? 'tooLarge' : 'fetchFailed');
    }
    $sniffed = asset_logo_sniff((string)$bytes);
    if (!$sniffed['ok']) return $result($sniffed['error']);
    return $sniffed + ['bytes' => (string)$bytes];
}

/** Unsere Header fuer ein ausgeliefertes Logo. */
function asset_logo_success_headers(array $result): array {
    return [
        'Content-Type' => $result['mime'],
        'Content-Length' => (string)strlen($result['bytes']),
        'Content-Disposition' => 'inline; filename="logo.' . $result['ext'] . '"',
        'Cache-Control' => 'public, max-age=' . ASSET_LOGO_CACHE_SECONDS,
        'X-Content-Type-Options' => 'nosniff',
        'Content-Security-Policy' => ASSET_LOGO_CSP,
        'Cross-Origin-Resource-Policy' => 'same-site',
    ];
}

// Voruebergehende Fehler: Horizon, stellar.toml oder Bild gerade nicht erreichbar, no-store. Gleiche Liste wie
// TRANSIENT_ERRORS in services/assetLogo.js und transientErrors in test/assets/asset-logo.json.
const ASSET_LOGO_TRANSIENT_ERRORS = ['issuerUnavailable', 'tomlUnavailable', 'fetchFailed'];

/** Header fuer "kein Logo" (404/502). Voruebergehende Fehler no-store, alle uebrigen eine Stunde. */
function asset_logo_error_headers(string $error): array {
    return [
        'Content-Type' => 'application/json; charset=utf-8',
        'Cache-Control' => in_array($error, ASSET_LOGO_TRANSIENT_ERRORS, true)
            ? 'no-store'
            : 'public, max-age=' . ASSET_LOGO_ERROR_CACHE_SECONDS,
        'X-Content-Type-Options' => 'nosniff',
    ];
}
