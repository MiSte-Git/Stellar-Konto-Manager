<?php
// Kontotyp einer Stellar-Adresse (SEP-23), PHP-Zwilling von services/addressKind.js und
// frontend/src/utils/stellar/addressType.js (ADR 0012, C-Konten vorbereiten). Alle drei laufen
// gegen test/assets/address-kinds.json.
//
// Der Kontotyp wird immer aus der Adresse abgeleitet und nie gespeichert.
//
// Ohne Stellar-SDK, damit federation.php und trade.php weiter ohne vendor/ laufen. Die
// Strkey-Pruefung (Versionsbyte, kanonisches Base32, CRC16) stammt unveraendert aus
// api/federationService.php und prueft wie StrKey im JS-SDK.
declare(strict_types=1);

const SKM_ADDRESS_KIND_ACCOUNT = 'account';
const SKM_ADDRESS_KIND_MUXED = 'muxed';
const SKM_ADDRESS_KIND_CONTRACT = 'contract';
const SKM_ADDRESS_KIND_MUXED_CONTRACT = 'muxedContract';
const SKM_ADDRESS_KIND_INVALID = 'invalid';

// Versionsbytes (SEP-23): G, M, C, W.
const SKM_STRKEY_VERSION_ACCOUNT = 6 << 3;
const SKM_STRKEY_VERSION_MUXED = 12 << 3;
const SKM_STRKEY_VERSION_CONTRACT = 2 << 3;
const SKM_STRKEY_VERSION_MUXED_CONTRACT = 22 << 3;

const SKM_STRKEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Syntaxregel ohne Pruefsumme (G plus 55 Base32-Zeichen), wie bisher STELLAR_PUBLIC_KEY_RE in
// api/trade.php. Eine Verschaerfung auf Pruefsumme waere eine eigene Aenderung.
// \z statt $: In PHP passt $ auch vor einem abschliessenden Zeilenumbruch, in JS nicht (K8).
const SKM_CLASSIC_ACCOUNT_SYNTAX_RE = '/^G[A-Z2-7]{55}\z/';

function skm_crc16_xmodem(string $data): int {
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

// Strkey mit fester Nutzlast dekodieren: Versionsbyte + Nutzlast + CRC16 (little-endian),
// Base32 ohne Padding. Ueberzaehlige Bits im letzten Zeichen muessen 0 sein (kanonisch), wie in
// StrKey des SDK. Liefert die Nutzlast oder null. Zeilenende per \z: ein abschliessender
// Zeilenumbruch ist nie gueltig, wie im JS- und PHP-SDK (K8).
function skm_strkey_decode($id, string $prefix, int $versionByte, int $payloadLength): ?string {
    $byteLength = 1 + $payloadLength + 2;
    $charLength = intdiv($byteLength * 8 + 4, 5);
    if (!is_string($id) || !preg_match('/^' . $prefix . '[A-Z2-7]{' . ($charLength - 1) . '}\z/', $id)) return null;
    $bits = '';
    for ($i = 0; $i < $charLength; $i++) {
        $bits .= str_pad(decbin(strpos(SKM_STRKEY_ALPHABET, $id[$i])), 5, '0', STR_PAD_LEFT);
    }
    if (strpos(substr($bits, $byteLength * 8), '1') !== false) return null;
    $bytes = '';
    foreach (str_split(substr($bits, 0, $byteLength * 8), 8) as $byte) $bytes .= chr(bindec($byte));
    if (strlen($bytes) !== $byteLength || ord($bytes[0]) !== $versionByte) return null;
    $checksum = ord($bytes[$byteLength - 2]) | (ord($bytes[$byteLength - 1]) << 8); // little-endian
    if (skm_crc16_xmodem(substr($bytes, 0, $byteLength - 2)) !== $checksum) return null;
    return substr($bytes, 1, $payloadLength);
}

// Gegenstueck zu skm_strkey_decode: Versionsbyte + Nutzlast + CRC16 (little-endian), Base32
// ohne Padding, ueberzaehlige Bits 0.
function skm_strkey_encode(int $versionByte, string $payload): string {
    $data = chr($versionByte) . $payload;
    $crc = skm_crc16_xmodem($data);
    $data .= chr($crc & 0xFF) . chr(($crc >> 8) & 0xFF);
    $bits = '';
    $len = strlen($data);
    for ($i = 0; $i < $len; $i++) $bits .= str_pad(decbin(ord($data[$i])), 8, '0', STR_PAD_LEFT);
    $bits = str_pad($bits, intdiv(strlen($bits) + 4, 5) * 5, '0', STR_PAD_RIGHT);
    $out = '';
    foreach (str_split($bits, 5) as $chunk) $out .= SKM_STRKEY_ALPHABET[bindec($chunk)];
    return $out;
}

/** @return string account | muxed | contract | muxedContract | invalid */
function skm_classify_address($input): string {
    if (!is_string($input) || $input === '') return SKM_ADDRESS_KIND_INVALID;
    if (skm_strkey_decode($input, 'G', SKM_STRKEY_VERSION_ACCOUNT, 32) !== null) return SKM_ADDRESS_KIND_ACCOUNT;
    if (skm_strkey_decode($input, 'M', SKM_STRKEY_VERSION_MUXED, 40) !== null) return SKM_ADDRESS_KIND_MUXED;
    if (skm_strkey_decode($input, 'C', SKM_STRKEY_VERSION_CONTRACT, 32) !== null) return SKM_ADDRESS_KIND_CONTRACT;
    if (skm_strkey_decode($input, 'W', SKM_STRKEY_VERSION_MUXED_CONTRACT, 40) !== null) return SKM_ADDRESS_KIND_MUXED_CONTRACT;
    return SKM_ADDRESS_KIND_INVALID;
}

/** G-Adresse zu einer G- oder M-Adresse (M: die ersten 32 Byte), sonst null. */
function skm_base_account_of($input): ?string {
    if (skm_strkey_decode($input, 'G', SKM_STRKEY_VERSION_ACCOUNT, 32) !== null) return $input;
    $muxed = skm_strkey_decode($input, 'M', SKM_STRKEY_VERSION_MUXED, 40);
    if ($muxed === null) return null;
    return skm_strkey_encode(SKM_STRKEY_VERSION_ACCOUNT, substr($muxed, 0, 32));
}

/** Nur G-Adressen, mit Pruefsumme. */
function skm_is_classic_account($input): bool {
    return skm_classify_address($input) === SKM_ADDRESS_KIND_ACCOUNT;
}

/** C- und W-Adressen (Contract, muxed Contract seit Protocol 30 / CAP-84). */
function skm_is_contract_address($input): bool {
    $kind = skm_classify_address($input);
    return $kind === SKM_ADDRESS_KIND_CONTRACT || $kind === SKM_ADDRESS_KIND_MUXED_CONTRACT;
}

/** G-Adresse nach Syntax, ohne Pruefsumme. Kein String: false. */
function skm_is_classic_account_syntax($input): bool {
    return is_string($input) && preg_match(SKM_CLASSIC_ACCOUNT_SYNTAX_RE, $input) === 1;
}
