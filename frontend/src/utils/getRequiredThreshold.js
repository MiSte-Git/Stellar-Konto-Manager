// Kategorien wie services/txSignatures.js und api/txSignatures.php (developers.stellar.org, List of operations).
const HIGH_OPS = new Set(['setOptions', 'accountMerge']);
const LOW_OPS = new Set(['allowTrust', 'inflation', 'bumpSequence', 'setTrustLineFlags', 'claimClaimableBalance']);

/**
 * Liefert das Gewicht, das eine Operation braucht.
 * Netzregel (Testnet-Probe 14.11.2026, scripts/testnet-threshold-probe.mjs): jede Transaktion
 * braucht mindestens low_threshold, die Operation zusaetzlich die Schwelle ihrer Kategorie.
 * Also max(low, Kategorie). Eine Kategorie-Schwelle 0 faellt nicht auf eine andere Schwelle zurueck.
 * 0 ist ein moeglicher Rueckgabewert; die Aufrufer verlangen ohnehin einen Signer.
 */
export function getRequiredThreshold(operationType, thresholds) {
  if (!thresholds || typeof thresholds !== 'object') {
    return 0;
  }

  const low = Number(thresholds.low_threshold ?? thresholds.lowThreshold ?? thresholds.low ?? 0);
  const med = Number(thresholds.med_threshold ?? thresholds.medThreshold ?? thresholds.med ?? 0);
  const high = Number(thresholds.high_threshold ?? thresholds.highThreshold ?? thresholds.high ?? 0);

  if (HIGH_OPS.has(operationType)) return Math.max(low, high);
  if (LOW_OPS.has(operationType)) return low;
  return Math.max(low, med);
}
