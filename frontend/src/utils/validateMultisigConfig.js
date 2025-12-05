export function validateMultisigConfig(signers = [], thresholds = {}) {
  const positiveSigners = (Array.isArray(signers) ? signers : []).filter((s) => (s?.weight || 0) > 0);
  const totalWeight = positiveSigners.reduce((acc, s) => acc + Number(s.weight || 0), 0);

  const low = Number(thresholds.low_threshold || thresholds.low || 0);
  const med = Number(thresholds.med_threshold || thresholds.med || 0);
  const high = Number(thresholds.high_threshold || thresholds.high || 0);

  if (positiveSigners.length === 0 && (low > 0 || med > 0 || high > 0)) {
    return { valid: false, reason: 'none' };
  }

  if (low > 0 && totalWeight < low) return { valid: false, reason: 'low' };
  if (med > 0 && totalWeight < med) return { valid: false, reason: 'med' };
  if (high > 0 && totalWeight < high) return { valid: false, reason: 'high' };

  return { valid: true };
}
