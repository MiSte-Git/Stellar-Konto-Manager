<?php
// Code und Issuer eines Assets aus der Anfrage (/facts, /logo). Gegenstueck zu normalizeAssetIdentity in
// services/tradeService.js. Review LP-6: nur Strings (code[]=x ergab vorher den Code "Array"), und trim()
// entfernt nur ASCII-Leerraum wie asciiTrim in Node (Node-trim() nahm vorher auch NBSP und BOM weg).
declare(strict_types=1);

require_once __DIR__ . '/addressKind.php';

const ASSET_IDENTITY_CODE_RE = '/^[A-Za-z0-9]{1,12}$/';

/** ['ok' => true, 'code', 'issuer'] oder ['ok' => false, 'error' => 'assetSearch.invalidInput:...']. */
function asset_identity_from_input($code, $issuer): array {
    if ($code !== null && !is_string($code)) return ['ok' => false, 'error' => 'assetSearch.invalidInput:codeInvalid'];
    if ($issuer !== null && !is_string($issuer)) return ['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'];
    $code = trim((string)$code);
    $issuer = trim((string)$issuer);
    if ($code === '' || !preg_match(ASSET_IDENTITY_CODE_RE, $code)) {
        return ['ok' => false, 'error' => 'assetSearch.invalidInput:codeInvalid'];
    }
    if ($issuer === '' || !skm_is_classic_account($issuer)) {
        return ['ok' => false, 'error' => 'assetSearch.invalidInput:issuerInvalid'];
    }
    return ['ok' => true, 'code' => $code, 'issuer' => $issuer];
}
