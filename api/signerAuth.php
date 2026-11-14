<?php
// Signer-Pruefung im PHP-Backend an einer Stelle (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 4).
// Node-Zwilling: services/signerAuth.js. Beide laufen gegen test/assets/signer-types.json.
//
// Hier und nur hier wird eine Signatur geprueft (Transaktionssignatur und Challenge, ADR 0004).
// Das Backend signiert nie. Ein kuenftiger Signer-Typ (z. B. quantensicher) verzweigt hier.
declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/addressKind.php';

use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Crypto\StrKey;

/** Einzige benannte Signaturlaenge (Ed25519). Korrektur K4: genau 64 Byte (vorher ohne eigene Pruefung). */
const SKM_SIGNATURE_BYTES = 64;
/** Hint einer DecoratedSignature: die letzten 4 Byte des Public Keys. */
const SKM_HINT_BYTES = 4;

const SKM_SIGNER_ED25519 = 'ed25519_public_key';
const SKM_SIGNER_SHA256_HASH = 'sha256_hash';
const SKM_SIGNER_PRE_AUTH_TX = 'preauth_tx';
const SKM_SIGNER_SIGNED_PAYLOAD = 'ed25519_signed_payload';
const SKM_SIGNER_UNKNOWN = 'unknown';
const SKM_KNOWN_SIGNER_TYPES = [SKM_SIGNER_ED25519, SKM_SIGNER_SHA256_HASH, SKM_SIGNER_PRE_AUTH_TX, SKM_SIGNER_SIGNED_PAYLOAD];

/** Schluessel eines Signers: String oder Array mit key, public_key, publicKey oder ed25519PublicKey. */
function skm_signer_key_of($signer): string {
    if (is_string($signer)) return $signer;
    if (!is_array($signer)) return '';
    foreach (['key', 'public_key', 'publicKey', 'ed25519PublicKey'] as $field) {
        if (isset($signer[$field]) && is_string($signer[$field]) && $signer[$field] !== '') return $signer[$field];
    }
    return '';
}

function skm_strkey_valid(callable $check, string $key): bool {
    try {
        return (bool)$check($key);
    } catch (\Throwable $e) {
        return false;
    }
}

// Typ aus dem Strkey, mit Pruefsumme. G ueber addressKind.php (ohne SDK, gleiche Regel wie Node).
function skm_checked_prefix_type(string $key): ?string {
    if ($key === '') return null;
    if (skm_is_classic_account($key)) return SKM_SIGNER_ED25519;
    if ($key[0] === 'T' && skm_strkey_valid([StrKey::class, 'isValidPreAuthTx'], $key)) return SKM_SIGNER_PRE_AUTH_TX;
    if ($key[0] === 'X' && skm_strkey_valid([StrKey::class, 'isValidSha256Hash'], $key)) return SKM_SIGNER_SHA256_HASH;
    if ($key[0] === 'P' && skm_strkey_valid([StrKey::class, 'isValidSignedPayload'], $key)) return SKM_SIGNER_SIGNED_PAYLOAD;
    return null;
}

function skm_letter_prefix_type(string $key): ?string {
    switch ($key === '' ? '' : $key[0]) {
        case 'G': return SKM_SIGNER_ED25519;
        case 'T': return SKM_SIGNER_PRE_AUTH_TX;
        case 'X': return SKM_SIGNER_SHA256_HASH;
        case 'P': return SKM_SIGNER_SIGNED_PAYLOAD;
        default: return null;
    }
}

/**
 * Typ eines Signers, gleiche Regel wie Node und Frontend: mit Horizon-Typ entscheidet der Typ, der erste
 * Buchstabe muss passen; ohne Typ der Strkey mit Pruefsumme; Widerspruch oder unbekannt ergibt unknown.
 */
function skm_signer_type_of($signer): string {
    $key = skm_signer_key_of($signer);
    $rawType = is_array($signer) && isset($signer['type']) && is_string($signer['type']) ? trim($signer['type']) : '';
    if ($rawType !== '') {
        if (!in_array($rawType, SKM_KNOWN_SIGNER_TYPES, true)) return SKM_SIGNER_UNKNOWN;
        return skm_letter_prefix_type($key) === $rawType ? $rawType : SKM_SIGNER_UNKNOWN;
    }
    return skm_checked_prefix_type($key) ?? SKM_SIGNER_UNKNOWN;
}

/** Nur Ed25519-Signer koennen eine Transaktion oder Challenge interaktiv signieren. */
function skm_is_interactive_signer($signer): bool {
    return skm_signer_type_of($signer) === SKM_SIGNER_ED25519;
}

/**
 * Strikte Dekodierung von Standard-base64 mit Padding (RFC 4648, wie das Frontend sendet), Korrektur K5:
 * kein base64url, keine Fremdzeichen, kein fehlendes Padding, keine nicht kanonische Form. null bei Fehler.
 */
function skm_decode_strict_base64($value): ?string {
    if (!is_string($value) || $value === '' || strlen($value) % 4 !== 0) return null;
    if (!preg_match('/^[A-Za-z0-9+\/]*={0,2}\z/', $value)) return null;
    $bytes = base64_decode($value, true);
    if ($bytes === false || base64_encode($bytes) !== $value) return null;
    return $bytes;
}

function skm_keypair_for_signer(string $publicKey): ?KeyPair {
    if (!skm_is_classic_account($publicKey)) return null;
    try {
        return KeyPair::fromAccountId($publicKey);
    } catch (\Throwable $e) {
        return null;
    }
}

/**
 * Passt eine Signatur (Hint und rohe Signatur als Bytes) zu diesem Signer und Transaktions-Hash?
 * Hint genau 4 Byte, Signatur genau SKM_SIGNATURE_BYTES, Hint gleich, dann Ed25519-Pruefung. Wirft nie.
 */
function skm_signature_matches_signer(string $hint, string $signature, string $publicKey, string $txHash): bool {
    if (strlen($hint) !== SKM_HINT_BYTES || strlen($signature) !== SKM_SIGNATURE_BYTES) return false;
    $kp = skm_keypair_for_signer($publicKey);
    if ($kp === null) return false;
    try {
        if (!hash_equals($kp->getHint(), $hint)) return false;
        return $kp->verifySignature($signature, $txHash);
    } catch (\Throwable $e) {
        return false;
    }
}

/**
 * Prueft eine Challenge-Signatur (ADR 0004): $signatureB64 strikt als Standard-base64, genau
 * SKM_SIGNATURE_BYTES, Ed25519 von $publicKey ueber $message. Wirft nie.
 */
function skm_verify_challenge(string $publicKey, string $message, string $signatureB64): bool {
    if ($message === '') return false;
    $signature = skm_decode_strict_base64($signatureB64);
    if ($signature === null || strlen($signature) !== SKM_SIGNATURE_BYTES) return false;
    $kp = skm_keypair_for_signer($publicKey);
    if ($kp === null) return false;
    try {
        return $kp->verifySignature($signature, $message);
    } catch (\Throwable $e) {
        return false;
    }
}
