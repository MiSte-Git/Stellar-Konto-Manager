// Signature hygiene for the multisig merge endpoint (finding M1, ultrareview
// 2026-07-06): the merge route used to accept every DecoratedSignature found
// in a submitted XDR verbatim into txXdrCurrent, valid or not. Since a
// signature is just an unauthenticated 4-byte hint + 64-byte blob at the XDR
// level, a caller could pad a job's stored transaction with garbage entries -
// at best wasted bytes, at worst pushing the envelope past Stellar's
// protocol-hard 20-signature ceiling and breaking it for every future
// submission attempt. This filters the merged signature set down to only
// signatures that verify against one of the account's real, live signers
// (the exact same hint+verify check collectSignersForTx already does per
// signer, just applied per individual signature here so invalid ones can be
// dropped instead of merely not counted), then caps whatever remains at 20.
const { Keypair } = require('@stellar/stellar-sdk');

const MAX_TX_SIGNATURES = 20; // Stellar XDR: Signatures is DecoratedSignature<20>

/**
 * @param {import('@stellar/stellar-sdk').Transaction} tx
 * @param {{ publicKey: string, weight: number }[]} signers
 * @returns {import('@stellar/stellar-sdk').xdr.DecoratedSignature[]}
 */
function filterValidSignatures(tx, signers = []) {
  const txHash = tx.hash();
  const keypairs = signers
    .filter((s) => Number(s?.weight || 0) > 0 && s?.publicKey)
    .map((s) => {
      try {
        return Keypair.fromPublicKey(s.publicKey);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const kept = tx.signatures.filter((sig) => keypairs.some((kp) => {
    try {
      return sig.hint().equals(kp.signatureHint()) && kp.verify(txHash, sig.signature());
    } catch {
      return false;
    }
  }));
  return kept.slice(0, MAX_TX_SIGNATURES);
}

module.exports = { filterValidSignatures, MAX_TX_SIGNATURES };
