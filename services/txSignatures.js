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

// Stellar's protocol assigns each operation type to a threshold category
// (low/medium/high) - SetOptions and AccountMerge are High, AllowTrust/
// Inflation/BumpSequence/SetTrustLineFlags are Low, everything else
// (Payment, CreateAccount, ChangeTrust, ManageData, ...) is Medium. Mirrors
// the identical categorization in api/txSignatures.php's requiredWeightForOperations().
const HIGH_THRESHOLD_OP_TYPES = new Set(['setOptions', 'accountMerge']);
const LOW_THRESHOLD_OP_TYPES = new Set(['allowTrust', 'inflation', 'bumpSequence', 'setTrustLineFlags']);

function operationThresholdCategory(opType) {
  if (HIGH_THRESHOLD_OP_TYPES.has(opType)) return 'high';
  if (LOW_THRESHOLD_OP_TYPES.has(opType)) return 'low';
  return 'med';
}

/**
 * Mirrors frontend/src/utils/getRequiredThreshold.js's per-category fallback
 * chains (used when an account leaves a threshold at 0), generalized across
 * every operation in the transaction: each operation is checked on-chain
 * against its own category, so the weight the whole transaction needs is
 * driven by whichever category present demands the most (high > med > low) -
 * a weight that satisfies the highest category automatically satisfies the
 * lower ones too, since thresholds are expected to be non-decreasing
 * (low <= med <= high).
 * @param {{ type?: string }[]} operations
 * @param {{ low?: number, med?: number, high?: number }} thresholds
 * @returns {number}
 */
function requiredWeightForOperations(operations, thresholds) {
  const low = Number(thresholds?.low || 0);
  const med = Number(thresholds?.med || 0);
  const high = Number(thresholds?.high || 0);
  const opTypes = (operations || []).map((op) => op?.type).filter(Boolean);
  if (!opTypes.length) return med || 0;

  const categories = new Set(opTypes.map(operationThresholdCategory));
  if (categories.has('high')) return high || med || low || 0;
  if (categories.has('med')) return med || high || low || 0;
  return med || low || high || 0; // pure low-category transaction
}

module.exports = {
  filterValidSignatures,
  MAX_TX_SIGNATURES,
  operationThresholdCategory,
  requiredWeightForOperations,
};
