<?php
// Kontotyp zentral, Backend PHP (Plan Signer-Buendelung, Schritt b2). api/addressKind.php laeuft
// gegen die gemeinsame Fixture test/assets/address-kinds.json, dieselbe wie
// test/addressKind.test.js und das Frontend. Die erwarteten Werte stammen aus dem JS-SDK.
//
// Verhaltensneutral: Die Referenzen unten sind die Implementierungen vor der Umstellung
// (Stand 7f20a96), wortgleich: die Strkey-Pruefung aus api/federationService.php,
// StrKey::isValidAccountId des PHP-SDK (Job anlegen in api/multisig.php),
// getEd25519AccountId() (txSourceBaseAccount) und die Regex aus api/trade.php.
//
// Run with: php test/addressKind.test.php

declare(strict_types=1);

require __DIR__ . '/../api/txSignatures.php'; // laedt vendor/autoload.php und addressKind.php
require __DIR__ . '/../api/federationService.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\BumpSequenceOperationBuilder;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Crypto\StrKey;
use Soneso\StellarSDK\MuxedAccount;
use Soneso\StellarSDK\TransactionBuilder;
use phpseclib3\Math\BigInteger;

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo "\xE2\x9C\x94 {$description}\n"; // ✔
    } else {
        $failed++;
        echo "\xE2\x9C\x98 {$description}\n"; // ✘
    }
}

// --- Referenzen: Stand vor der Umstellung (api/federationService.php, wortgleich) -------------
function old_federation_crc16_xmodem(string $data): int {
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

function old_federation_is_valid_account_id($id): bool {
    return old_federation_is_valid_strkey32($id, 'G', 6 << 3);
}

function old_federation_is_contract_address($id): bool {
    if (!is_string($id)) return false;
    return old_federation_is_valid_strkey32($id, 'C', 2 << 3) || old_federation_is_valid_strkey($id, 'W', 22 << 3, 40);
}

function old_federation_is_valid_strkey32($id, string $prefix, int $versionByte): bool {
    return old_federation_is_valid_strkey($id, $prefix, $versionByte, 32);
}

function old_federation_is_valid_strkey($id, string $prefix, int $versionByte, int $payloadLength): bool {
    $byteLength = 1 + $payloadLength + 2;
    $charLength = intdiv($byteLength * 8 + 4, 5);
    if (!is_string($id) || !preg_match('/^' . $prefix . '[A-Z2-7]{' . ($charLength - 1) . '}$/', $id)) return false;
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    for ($i = 0; $i < $charLength; $i++) {
        $bits .= str_pad(decbin(strpos($alphabet, $id[$i])), 5, '0', STR_PAD_LEFT);
    }
    if (strpos(substr($bits, $byteLength * 8), '1') !== false) return false;
    $bytes = '';
    foreach (str_split(substr($bits, 0, $byteLength * 8), 8) as $byte) $bytes .= chr(bindec($byte));
    if (strlen($bytes) !== $byteLength || ord($bytes[0]) !== $versionByte) return false;
    $checksum = ord($bytes[$byteLength - 2]) | (ord($bytes[$byteLength - 1]) << 8); // little-endian
    return old_federation_crc16_xmodem(substr($bytes, 0, $byteLength - 2)) === $checksum;
}

const OLD_STELLAR_PUBLIC_KEY_RE = '/^G[A-Z2-7]{55}$/'; // api/trade.php

function old_trade_issuer_invalid(string $issuer): bool {
    return $issuer === '' || !preg_match(OLD_STELLAR_PUBLIC_KEY_RE, $issuer);
}

function sdk_classify(string $a): string {
    if (StrKey::isValidAccountId($a)) return 'account';
    if (StrKey::isValidMuxedAccountId($a)) return 'muxed';
    if (StrKey::isValidContractId($a)) return 'contract';
    if (StrKey::isValidMuxedContractId($a)) return 'muxedContract';
    return 'invalid';
}

// --- Fixture --------------------------------------------------------------------------------
$fixture = json_decode((string)file_get_contents(__DIR__ . '/assets/address-kinds.json'), true);
check('Fixture geladen', is_array($fixture['cases'] ?? null) && count($fixture['cases']) > 10);

foreach ($fixture['cases'] as $c) {
    $a = $c['address'];
    $l = $c['label'];
    check("Fixture {$l}: skm_classify_address = {$c['kind']}", skm_classify_address($a) === $c['kind']);
    check("Fixture {$l}: skm_base_account_of", skm_base_account_of($a) === $c['baseAccountId']);
    check("Fixture {$l}: skm_is_classic_account", skm_is_classic_account($a) === $c['isClassicAccount']);
    check("Fixture {$l}: skm_is_classic_account_syntax", skm_is_classic_account_syntax($a) === $c['isClassicAccountSyntax']);
    check("Fixture {$l}: skm_is_contract_address", skm_is_contract_address($a) === in_array($c['kind'], ['contract', 'muxedContract'], true));
    // PHP-SDK gegen JS-SDK (Punkt 5): dieselbe Einordnung
    check("Fixture {$l}: PHP-SDK StrKey wie JS-SDK", sdk_classify($a) === $c['kind']);

    // Ohne Trim: auch das PHP-SDK direkt (Job anlegen vergleicht nach trim, siehe unten)
    check("Fixture {$l}: eigene Pruefung wie PHP-SDK ohne trim", skm_is_classic_account($a) === StrKey::isValidAccountId($a));

    // Alt gegen neu. Korrektur K8: Ein abschliessender Zeilenumbruch galt in der alten
    // Federation-Pruefung als gueltig ($ in der PHP-Regex), jetzt nie mehr (wie SDK und Node).
    $k8 = preg_match('/[\r\n]\z/', $a) === 1;
    if ($k8) {
        check("K8 {$l}: Federation lehnt jetzt ab", !federation_is_valid_account_id($a) && !federation_is_contract_address($a));
    } else {
        check("Alt/neu {$l}: federation_is_valid_account_id", federation_is_valid_account_id($a) === old_federation_is_valid_account_id($a));
        check("Alt/neu {$l}: federation_is_contract_address", federation_is_contract_address($a) === old_federation_is_contract_address($a));
    }
    check("Alt/neu {$l}: Job anlegen (StrKey::isValidAccountId nach trim)", skm_is_classic_account(trim($a)) === StrKey::isValidAccountId(trim($a)));
    check("Alt/neu {$l}: trade.php Issuer-Regel", (trim($a) === '' || !skm_is_classic_account_syntax(trim($a))) === old_trade_issuer_invalid(trim($a)));
}

// --- K8: Zeilenumbruch am Ende ist nie gueltig ----------------------------------------------
$gSyntax = 'G' . str_repeat('A', 55);
check('K8: Syntaxfunktion G plus 55 Zeichen ist true', skm_is_classic_account_syntax($gSyntax) === true);
check('K8: Syntaxfunktion mit \n am Ende ist false', skm_is_classic_account_syntax($gSyntax . "\n") === false);
check('K8: Syntaxfunktion mit \r\n am Ende ist false', skm_is_classic_account_syntax($gSyntax . "\r\n") === false);
check('K8: alte trade.php-Regex nahm \n am Ende an (Grund fuer K8)', preg_match(OLD_STELLAR_PUBLIC_KEY_RE, $gSyntax . "\n") === 1);
$gValid = KeyPair::random()->getAccountId();
check('K8: skm_base_account_of mit \n am Ende ist null', skm_base_account_of($gValid . "\n") === null);
check('K8: alte Federation-Pruefung nahm \n am Ende an (Grund fuer K8)', old_federation_is_valid_account_id($gValid . "\n") === true);

// --- Kein String ----------------------------------------------------------------------------
foreach ([null, 123, [], true] as $v) {
    $t = json_encode($v);
    check("kein String {$t}: invalid", skm_classify_address($v) === 'invalid' && skm_base_account_of($v) === null);
    check("kein String {$t}: federation wie vorher", federation_is_valid_account_id($v) === old_federation_is_valid_account_id($v)
        && federation_is_contract_address($v) === old_federation_is_contract_address($v));
    check("kein String {$t}: Syntax false", skm_is_classic_account_syntax($v) === false);
}

// --- Zufaellige Abwandlungen: eigene Pruefung gegen PHP-SDK und alte Federation-Pruefung -----
mt_srand(12011);
$alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567abcz019 ';
$bases = [];
foreach ($fixture['cases'] as $c) {
    if (in_array($c['kind'], ['account', 'muxed', 'contract', 'muxedContract'], true)) $bases[] = $c['address'];
}
for ($i = 0; $i < 20; $i++) $bases[] = KeyPair::random()->getAccountId();
$mismatchSdk = 0;
$mismatchOld = 0;
$total = 0;
foreach ($bases as $base) {
    for ($k = 0; $k < 40; $k++) {
        $v = $base;
        $pos = mt_rand(0, strlen($v) - 1);
        $v[$pos] = $alphabet[mt_rand(0, strlen($alphabet) - 1)];
        if (mt_rand(0, 9) === 0) $v = substr($v, 0, -1);
        $total++;
        // Job anlegen: trim, dann PHP-SDK
        if (skm_is_classic_account(trim($v)) !== StrKey::isValidAccountId(trim($v))) $mismatchSdk++;
        if (skm_classify_address(trim($v)) !== sdk_classify(trim($v))) $mismatchSdk++;
        if (federation_is_valid_account_id($v) !== old_federation_is_valid_account_id($v)) $mismatchOld++;
        if (federation_is_contract_address($v) !== old_federation_is_contract_address($v)) $mismatchOld++;
    }
}
check("Zufall ({$total} Abwandlungen): eigene Pruefung wie PHP-SDK", $mismatchSdk === 0);
check("Zufall ({$total} Abwandlungen): Federation wie vorher", $mismatchOld === 0);

// --- Encoder: Basiskonto einer M-Adresse wie das PHP-SDK -------------------------------------
$encOk = true;
for ($i = 0; $i < 30; $i++) {
    $kp = KeyPair::random();
    $id = $i === 0 ? '0' : ($i === 1 ? '18446744073709551615' : (string)mt_rand(1, PHP_INT_MAX));
    $m = new MuxedAccount($kp->getAccountId(), (int)($i === 1 ? 0 : $id));
    $mAddr = $i === 1 ? null : $m->getAccountId();
    if ($mAddr !== null && ($mAddr[0] !== 'M' || skm_base_account_of($mAddr) !== $kp->getAccountId())) $encOk = false;
    if (skm_strkey_encode(SKM_STRKEY_VERSION_ACCOUNT, StrKey::decodeAccountId($kp->getAccountId())) !== $kp->getAccountId()) $encOk = false;
}
check('skm_strkey_encode und skm_base_account_of wie das PHP-SDK', $encOk);

// --- txSourceBaseAccount: alt (getEd25519AccountId) gegen neu --------------------------------
function bump_tx($source) {
    return (new TransactionBuilder($source))
        ->addOperation((new BumpSequenceOperationBuilder(new BigInteger(200)))->build())
        ->build();
}
$txOk = true;
for ($i = 0; $i < 10; $i++) {
    $kp = KeyPair::random();
    $plain = new Account($kp->getAccountId(), new BigInteger(100));
    $muxed = new Account($kp->getAccountId(), new BigInteger(100), $i * 7919 + 1);
    foreach ([$plain, $muxed] as $src) {
        $tx = bump_tx($src);
        $old = $tx->getSourceAccount()->getEd25519AccountId();
        if ($tx->getSourceAccount()->getAccountId()[0] !== ($src === $muxed ? 'M' : 'G')) $txOk = false;
        if (txSourceBaseAccount($tx) !== $old || $old !== $kp->getAccountId()) $txOk = false;
    }
}
check('txSourceBaseAccount: G und M als Quelle wie vorher', $txOk);

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
