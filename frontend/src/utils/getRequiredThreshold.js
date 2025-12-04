/**
 * Liefert den benötigten Threshold für eine Operation.
 * Fallback: med_threshold, sonst high/low, sonst 0.
 */
export function getRequiredThreshold(operationType, thresholds) {
  if (!thresholds || typeof thresholds !== 'object') {
    return 0;
  }

  const low = Number(thresholds.low_threshold ?? thresholds.lowThreshold ?? thresholds.low ?? 0);
  const med = Number(thresholds.med_threshold ?? thresholds.medThreshold ?? thresholds.med ?? 0);
  const high = Number(thresholds.high_threshold ?? thresholds.highThreshold ?? thresholds.high ?? 0);

  if (operationType === 'setOptions') return high || med || low || 0;
  if (operationType === 'payment') return med || high || low || 0;

  return med || low || high || 0;
}
