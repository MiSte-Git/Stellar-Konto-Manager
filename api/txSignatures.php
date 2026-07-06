<?php
// Signature hygiene for the multisig merge endpoint (finding M1, ultrareview
// 2026-07-06): the merge route used to accept every XdrDecoratedSignature
// found in a submitted XDR verbatim into txXdrCurrent, valid or not. Since a
// signature is just an unauthenticated 4-byte hint + 64-byte blob at the XDR
// level, a caller could pad a job's stored transaction with garbage entries -
// at best wasted bytes, at worst pushing the envelope past Stellar's
// protocol-hard 20-signature ceiling and breaking it for every future
// submission attempt. This filters the merged signature set down to only
// signatures that verify against one of the account's real, live signers
// (the exact same hint+verify check verifyCollected() already does per
// signer, just applied per individual signature here so invalid ones can be
// dropped instead of merely not counted), then caps whatever remains at 20.
declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use Soneso\StellarSDK\AbstractTransaction;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\Xdr\XdrDecoratedSignature;

const MAX_TX_SIGNATURES = 20; // Stellar XDR: Signatures is DecoratedSignature<20>

/**
 * @param array{publicKey: string, weight: int}[] $signers
 * @return XdrDecoratedSignature[]
 */
function filterValidSignatures(AbstractTransaction $tx, string $net, array $signers): array {
    $network = $net === 'public' ? Network::public() : Network::testnet();
    // signatureBase() returns the *preimage* (network id + envelope type +
    // tagged transaction); what actually gets ed25519-signed by sign() is the
    // SHA256 digest of that preimage, i.e. hash(). Verifying against
    // signatureBase() directly (as this function did before this fix) means
    // verifySignature() never matches any genuine signature - collectedWeight
    // was silently always 0, so no PHP-backed job could ever be detected as
    // fully signed no matter how many valid signatures it collected.
    $base = $tx->hash($network);

    $keypairs = [];
    foreach ($signers as $s) {
        $pub = $s['publicKey'] ?? null;
        $weight = (int)($s['weight'] ?? 0);
        if (!$pub || $weight <= 0) continue;
        try {
            $keypairs[] = KeyPair::fromAccountId($pub);
        } catch (\Throwable $e) {
            continue;
        }
    }

    $kept = [];
    foreach ($tx->getSignatures() as $sig) {
        if (!$sig instanceof XdrDecoratedSignature) continue;
        foreach ($keypairs as $kp) {
            try {
                if ($sig->getHint() === $kp->getHint() && $kp->verifySignature($sig->getRawSignature(), $base)) {
                    $kept[] = $sig;
                    break;
                }
            } catch (\Throwable $e) {
                continue;
            }
        }
    }
    return array_slice($kept, 0, MAX_TX_SIGNATURES);
}

/**
 * Returns the subset of $signers (each { publicKey, weight }) that have a
 * genuinely valid signature on $tx. This is the sole source of truth for
 * collectedWeight in both multisig.php routes (H2 fix): there is no
 * client-suppliable input that can add an entry here short of an actual
 * verifying signature from that exact key.
 * @param array{publicKey: string, weight: int}[] $signers
 * @return array{publicKey: string, weight: int}[]
 */
function verifyCollected(AbstractTransaction $tx, string $net, array $signers): array {
    $network = $net === 'public' ? Network::public() : Network::testnet();
    // hash(), not signatureBase() - see the comment in filterValidSignatures() above.
    $base = $tx->hash($network);
    $result = [];
    $seen = [];
    foreach ($signers as $s) {
        $pub = $s['publicKey'] ?? null;
        $weight = (int)($s['weight'] ?? 0);
        if (!$pub || $weight <= 0) continue;
        try {
            $kp = KeyPair::fromAccountId($pub);
        } catch (\Throwable $e) {
            continue;
        }
        $hint = $kp->getHint();
        foreach ($tx->getSignatures() as $sig) {
            if (!$sig instanceof XdrDecoratedSignature) continue;
            if ($sig->getHint() !== $hint) continue;
            try {
                if ($kp->verifySignature($sig->getRawSignature(), $base)) {
                    $accId = $kp->getAccountId();
                    if (!isset($seen[$accId])) {
                        $result[] = ['publicKey' => $accId, 'weight' => $weight];
                        $seen[$accId] = true;
                    }
                    break;
                }
            } catch (\Throwable $e) {
                continue;
            }
        }
    }
    return $result;
}

/**
 * Merges two transactions' signature lists (dedup by raw hint+signature
 * bytes) onto $target and returns it. Does not verify anything - callers are
 * expected to run the result through filterValidSignatures() before
 * persisting it (M1 fix).
 */
function mergeSignatures(AbstractTransaction $target, AbstractTransaction $incoming): AbstractTransaction {
    $map = [];
    $merged = [];
    $addSig = function (XdrDecoratedSignature $sig) use (&$map, &$merged) {
        $key = base64_encode($sig->getHint() . $sig->getSignature());
        if (isset($map[$key])) return;
        $map[$key] = true;
        $merged[] = $sig;
    };
    foreach ($target->getSignatures() as $s) {
        if ($s instanceof XdrDecoratedSignature) $addSig($s);
    }
    foreach ($incoming->getSignatures() as $s) {
        if ($s instanceof XdrDecoratedSignature) $addSig($s);
    }
    $target->setSignatures($merged);
    return $target;
}
