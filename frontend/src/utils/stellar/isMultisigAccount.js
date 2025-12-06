// Checks whether the account has multisig enabled.
export function isMultisigAccount(account) {
  if (!account || !account.signers || !account.thresholds) return false;

  const signerCount = Array.isArray(account.signers) ? account.signers.filter(Boolean).length : 0;
  const highThreshold = Number(account.thresholds.high ?? account.thresholds.high_threshold ?? 0);

  const hasMultipleSigners = signerCount > 1;
  const hasHighThreshold = highThreshold > 1;

  return hasMultipleSigners || hasHighThreshold;
}
