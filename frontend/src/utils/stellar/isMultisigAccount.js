// Checks whether the account has multisig enabled.
export function isMultisigAccount(account) {
  if (!account || !account.signers || !account.thresholds) return false;

  const signerCount = Array.isArray(account.signers) ? account.signers.filter(Boolean).length : 0;
  const highThreshold = Number(account.thresholds.high ?? account.thresholds.high_threshold ?? 0);

  const hasMultipleSigners = signerCount > 1;
  const hasHighThreshold = highThreshold > 1;

  return hasMultipleSigners || hasHighThreshold;
}

// Reicht ein einzelner Signer fuer die geforderte Schwelle? Dann braucht die Aktion keine
// Multisig-Abstimmung, auch wenn das Konto mehrere Signer hat (z. B. Low-Operationen wie
// das Einloesen einer Claimable Balance bei low=1). Nur Ed25519-Signer zaehlen, Hash- und
// Pre-Auth-Signer koennen nicht interaktiv signieren.
export function singleSignerSuffices(account, requiredWeight) {
  const required = Number(requiredWeight) || 0;
  if (required <= 0) return true;
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const maxWeight = signers
    .filter((s) => !s?.type || s.type === 'ed25519_public_key')
    .reduce((max, s) => Math.max(max, Number(s?.weight || 0)), 0);
  return maxWeight >= required;
}

// Mehrere Signaturen noetig: Multisig-Konto und kein einzelner Signer erreicht die Schwelle.
export function needsMultipleSignatures(account, requiredWeight) {
  return isMultisigAccount(account) && !singleSignerSuffices(account, requiredWeight);
}
