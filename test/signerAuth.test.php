<?php
// Signer-Pruefung zentral im PHP-Backend (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 4).
// api/signerAuth.php sowie verifyCollected/filterValidSignatures in api/txSignatures.php und
// verifyChallengeSignature in api/challengeStore.php. Node-Zwilling: test/signerAuth.test.js mit
// denselben Fixtures (signer-types.json, challenge-vector.json).
//
// Run with: php test/signerAuth.test.php

declare(strict_types=1);

require __DIR__ . '/../api/txSignatures.php';
require __DIR__ . '/../api/challengeStore.php';

use Soneso\StellarSDK\Account;
use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\BumpSequenceOperationBuilder;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Crypto\StrKey;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\TransactionBuilder;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;
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

const NET = 'testnet';

$signerTypes = json_decode((string)file_get_contents(__DIR__ . '/assets/signer-types.json'), true);
$vector = json_decode((string)file_get_contents(__DIR__ . '/assets/challenge-vector.json'), true);

// --- Signer-Typ: gemeinsame Fixture mit Node und Frontend --------------------------------------
check('Fixture signer-types geladen', is_array($signerTypes['cases'] ?? null) && count($signerTypes['cases']) > 10);
foreach ($signerTypes['cases'] as $c) {
    $signer = $c['type'] === null ? ['key' => $c['key']] : ['key' => $c['key'], 'type' => $c['type']];
    check("skm_signer_type_of {$c['label']} = {$c['expected']}", skm_signer_type_of($signer) === $c['expected']);
    check("skm_is_interactive_signer {$c['label']}", skm_is_interactive_signer($signer) === $c['interactive']);
}

// --- Transaktionssignaturen -------------------------------------------------------------------
$network = Network::testnet();
$a = KeyPair::random();
$b = KeyPair::random();

function buildTx(KeyPair $source): AbstractTransaction {
    $account = new Account($source->getAccountId(), new BigInteger('100'));
    $op = (new BumpSequenceOperationBuilder(new BigInteger('101')))->build();
    $xdr = (new TransactionBuilder($account))->addOperation($op)->build()->toEnvelopeXdrBase64();
    return AbstractTransaction::fromEnvelopeBase64XdrString($xdr);
}
function entry(KeyPair $kp, int $weight = 1, ?string $type = null): array {
    $e = ['publicKey' => $kp->getAccountId(), 'weight' => $weight];
    if ($type !== null) $e['type'] = $type;
    return $e;
}

$tx = buildTx($a);
$hash = $tx->hash($network);
$sigA = $a->sign($hash);
check('gueltige Signatur eines Signers passt', skm_signature_matches_signer($a->getHint(), $sigA, $a->getAccountId(), $hash));
$bad = $sigA; $bad[0] = chr(ord($bad[0]) ^ 1);
check('manipulierte Signatur passt nicht', !skm_signature_matches_signer($a->getHint(), $bad, $a->getAccountId(), $hash));
check('falscher Signer passt nicht', !skm_signature_matches_signer($a->getHint(), $sigA, $b->getAccountId(), $hash));
check('fremder Hash passt nicht', !skm_signature_matches_signer($a->getHint(), $sigA, $a->getAccountId(), buildTx($b)->hash($network)));
check('kein gueltiger Key passt nicht', !skm_signature_matches_signer($a->getHint(), $sigA, 'kein-key', $hash));

// K4: genau 64 Byte, Hint genau 4 Byte
check('SKM_SIGNATURE_BYTES ist 64', SKM_SIGNATURE_BYTES === 64);
check('K4: Signatur mit 63 Byte passt nie', !skm_signature_matches_signer($a->getHint(), substr($sigA, 0, 63), $a->getAccountId(), $hash));
check('K4: Signatur mit 65 Byte passt nie', !skm_signature_matches_signer($a->getHint(), $sigA . "\x00", $a->getAccountId(), $hash));
check('K4: Hint mit 3 Byte passt nie', !skm_signature_matches_signer(substr($a->getHint(), 0, 3), $sigA, $a->getAccountId(), $hash));
check('K4: Hint mit 5 Byte passt nie', !skm_signature_matches_signer($a->getHint() . "\x00", $sigA, $a->getAccountId(), $hash));

// Nicht-Signer mit passendem Hint
$other = KeyPair::random();
$txHint = buildTx($a);
$txHint->setSignatures([new XdrDecoratedSignature($a->getHint(), $other->sign($txHint->hash($network)))]);
check('Nicht-Signer mit passendem Hint zaehlt nicht', verifyCollected($txHint, NET, [entry($a)]) === []);
check('Nicht-Signer mit passendem Hint wird beim Merge verworfen', count(filterValidSignatures($txHint, NET, [entry($a)])) === 0);

// zwei Signaturen desselben Signers
$txTwice = buildTx($a);
$txTwice->sign($a, $network);
$txTwice->sign($a, $network);
$c = verifyCollected($txTwice, NET, [entry($a, 2), entry($a, 2)]);
check('zwei Signaturen desselben Signers: Gewicht einmal', count($c) === 1 && $c[0]['weight'] === 2);

// Gewicht 0
$txZero = buildTx($a);
$txZero->sign($a, $network);
$txZero->sign($b, $network);
$c = verifyCollected($txZero, NET, [entry($a, 1), entry($b, 0)]);
check('Signer mit Gewicht 0 zaehlt nicht', count($c) === 1 && $c[0]['publicKey'] === $a->getAccountId());
check('Signatur eines Signers mit Gewicht 0 wird beim Merge verworfen', count(filterValidSignatures($txZero, NET, [entry($a, 1), entry($b, 0)])) === 1);

// T-, X-Signer und Widerspruch
$txOne = buildTx($a);
$txOne->sign($a, $network);
$t = StrKey::encodePreAuthTx(str_repeat("\x01", 32));
$x = StrKey::encodeSha256Hash(str_repeat("\x02", 32));
check('T- und X-Signer werden uebersprungen', verifyCollected($txOne, NET, [['publicKey' => $t, 'weight' => 5], ['publicKey' => $x, 'weight' => 5, 'type' => 'sha256_hash']]) === []);
check('G-Key mit falschem Horizon-Typ zaehlt nicht', verifyCollected($txOne, NET, [entry($a, 1, 'sha256_hash')]) === []);
$c = verifyCollected($txOne, NET, [entry($a, 1, 'ed25519_public_key')]);
check('G-Key mit passendem Horizon-Typ zaehlt', count($c) === 1);

// --- Challenge (ADR 0004), Korrektur K5 ---------------------------------------------------------
check('Vektor: Secret passt zum Public Key', KeyPair::fromSeed($vector['secret'])->getAccountId() === $vector['publicKey']);
check('Challenge: Ausgabe von signMultisigJobChallenge (fester Vektor) wird angenommen',
    verifyChallengeSignature($vector['nonce'], $vector['signature'], $vector['publicKey'], $vector['purpose']) === true);
$sig = $vector['signature'];
$variants = [
    'Fremdzeichen' => substr($sig, 0, 10) . '!' . substr($sig, 10),
    'Leerzeichen' => ' ' . $sig,
    'Zeilenumbruch' => $sig . "\n",
    'ohne Padding' => rtrim($sig, '='),
    'base64url' => strtr($sig, '+/', '-_'),
    'base64url ohne Padding' => rtrim(strtr($sig, '+/', '-_'), '='),
    'gekuerzt' => substr($sig, 0, -4),
];
foreach ($variants as $name => $value) {
    check("K5: Signatur {$name} wird abgelehnt", verifyChallengeSignature($vector['nonce'], $value, $vector['publicKey'], $vector['purpose']) === false);
}
check('Challenge: falscher Zweck wird abgelehnt', verifyChallengeSignature($vector['nonce'], $sig, $vector['publicKey'], 'decline') === false);
check('Challenge: falscher Key wird abgelehnt', verifyChallengeSignature($vector['nonce'], $sig, KeyPair::random()->getAccountId(), $vector['purpose']) === false);
check('Challenge: 63 Byte werden abgelehnt', verifyChallengeSignature($vector['nonce'], base64_encode(substr(base64_decode($sig), 0, 63)), $vector['publicKey'], $vector['purpose']) === false);

check('skm_decode_strict_base64: AAEC', skm_decode_strict_base64('AAEC') === "\x00\x01\x02");
check('skm_decode_strict_base64: AAE=', skm_decode_strict_base64('AAE=') === "\x00\x01");
foreach (['', 'AAE', 'AA-_', 'AAF=', 'AA==AA=='] as $v) {
    check("skm_decode_strict_base64 lehnt '{$v}' ab", skm_decode_strict_base64($v) === null);
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
