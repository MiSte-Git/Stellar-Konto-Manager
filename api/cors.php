<?php
// Shared CORS origin allowlist for all api/*.php endpoints (finding #9) -
// single source of truth so the allowlist can't drift between files (it
// previously had, silently: trade.php was missing skm.steei.de/PROD_ORIGIN
// that admin.php/bugreport.php/multisig.php already had).
//
// G3: apply_cors_headers() weist einen Request, dessen Origin-Header nicht in
// der Allowlist steht, sofort mit 403 { ok: false, error: forbidden_origin } ab,
// auch beim OPTIONS-Preflight. Vorher fehlte nur Access-Control-Allow-Origin
// und der Endpunkt lief trotzdem (ein text/plain-Formular erreichte z. B. das
// Anlegen von Bugreports oder die Multisig-Challenge). Requests ohne
// Origin-Header (gleiche Origin bei GET, Skripte, Monitoring) bleiben erlaubt.
// Node-Pendant: services/corsConfig.js (gleiche feste Liste, gleiche
// Normalisierung von PROD_ORIGIN).
declare(strict_types=1);

// Every endpoint requires this file, so the API security headers are set
// here once for all of them (and for any future endpoint).
require_once __DIR__ . '/securityHeaders.php';
apply_api_security_headers();

/**
 * Normalisiert einen Origin-Wert so, wie ein Browser ihn sendet:
 * schema://host[:port], ohne Pfad, ohne Slash am Ende, Host in
 * Kleinbuchstaben, Standardport weggelassen. Gibt null fuer ungueltige Werte
 * zurueck. Gleiche Regeln wie normalizeOrigin() in services/corsConfig.js.
 */
function cors_normalize_origin(string $value): ?string {
    // G3-1: trim() entfernt nur Leerzeichen, \t, \n, \r, NUL und \v; Node nutzt dieselbe
    // Zeichenmenge (trimAscii in services/corsConfig.js), nicht String.trim() mit NBSP und BOM.
    // B3-6: kein s-Flag, wie in Node: ein Zeilenumbruch im Pfad macht die Origin ungueltig.
    if (!preg_match('~^(https?)://([^/?#@\s]+)(?:[/?#].*)?$~i', trim($value), $m)) return null;
    $scheme = strtolower($m[1]);
    $authority = strtolower($m[2]);
    if (!preg_match('~^(.*?)(?::(\d{1,5}))?$~s', $authority, $pm)) return null;
    $host = $pm[1];
    if (!preg_match('~^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$~', $host)) return null;
    $port = '';
    if (isset($pm[2]) && $pm[2] !== '') {
        $n = (int)$pm[2];
        if ($n < 1 || $n > 65535) return null;
        $isDefault = ($scheme === 'http' && $n === 80) || ($scheme === 'https' && $n === 443);
        if (!$isDefault) $port = ':' . $n;
    }
    return $scheme . '://' . $host . $port;
}

/**
 * Feste Eintraege (gleich wie FIXED_APP_ORIGINS in services/corsConfig.js)
 * plus das normalisierte PROD_ORIGIN.
 *
 * Abweichung zu Node, bewusst: Node nimmt zusaetzlich die Origin aus
 * PROD_API_URL auf. Das ist dort die API-Adresse, gegen die das Frontend
 * gebaut wird (Frontend und API auf demselben Host). Auf dem Hosting ist
 * PROD_API_URL nicht gesetzt (nur Build-Variable in .env), und der einzige
 * Produktionshost https://skm.steei.de steht hier fest in der Liste.
 * www.skm.steei.de braucht keinen Eintrag: das Frontend leitet www per 301 auf
 * skm.steei.de um (frontend/.htaccess.template), eine SKM-Seite laeuft also
 * nie unter www.
 */
function cors_allowed_origins(): array {
    $origins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://skm.steei.de',
    ];
    $raw = getenv('PROD_ORIGIN');
    if (is_string($raw) && trim($raw) !== '') {
        $normalized = cors_normalize_origin($raw);
        if ($normalized !== null) {
            if (!in_array($normalized, $origins, true)) $origins[] = $normalized;
        } else {
            // PHP baut die Liste je Request neu; einmal je Request loggen.
            static $logged = false;
            if (!$logged) {
                $logged = true;
                error_log('[cors] PROD_ORIGIN ist keine gueltige Origin und wird ignoriert: ' . json_encode($raw));
            }
        }
    }
    return $origins;
}

/** true, wenn $origin exakt (nach Browser-Schreibweise) in der Allowlist steht. */
function cors_origin_allowed(?string $origin): bool {
    if ($origin === null || $origin === '') return false;
    return in_array($origin, cors_allowed_origins(), true);
}

/**
 * G3: Steht ein Origin-Header im Request, der nicht in der Allowlist steht
 * (auch leer oder "null"), endet der Request hier mit 403 forbidden_origin.
 * Ohne Origin-Header passiert nichts.
 */
function cors_reject_foreign_origin(): void {
    if (!array_key_exists('HTTP_ORIGIN', $_SERVER)) return;
    $origin = (string)$_SERVER['HTTP_ORIGIN'];
    if (cors_origin_allowed($origin)) return;
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Vary: Origin');
    echo json_encode(['ok' => false, 'error' => 'forbidden_origin']);
    exit;
}

/**
 * Rejects a foreign Origin with 403 (G3, see cors_reject_foreign_origin), then
 * sets Access-Control-Allow-Origin (+ Vary, and Credentials if requested) for
 * an allowlisted Origin, plus the given Methods/Headers. Does NOT handle the
 * OPTIONS preflight short-circuit for allowed origins - callers keep doing that
 * themselves, since their exact status codes/exit points differ (204 vs 200).
 */
function apply_cors_headers(array $allowedMethods, array $allowedHeaders, bool $withCredentials = false): void {
    cors_reject_foreign_origin();
    // Die Antwort haengt von Origin ab: Vary immer setzen, auch ohne Origin-Header.
    header('Vary: Origin');
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        if ($withCredentials) header('Access-Control-Allow-Credentials: true');
    }
    header('Access-Control-Allow-Methods: ' . implode(', ', $allowedMethods));
    header('Access-Control-Allow-Headers: ' . implode(', ', $allowedHeaders));
}
