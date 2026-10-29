import { fromStroops } from '../../utils/stellar/liquidityPools.js';

/**
 * Stroops (BigInt) -> lokalisierte Anzeige ohne Float-Umweg: Tausender-
 * Trennung ueber BigInt.toLocaleString, Nachkommastellen ohne Nullen am Ende.
 */
export function formatPoolAmount(stroops, locale) {
  const [whole, frac] = fromStroops(stroops).split('.');
  let decimal = '.';
  try {
    decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value || '.';
  } catch { /* noop */ }
  let wholeText = whole;
  try {
    wholeText = BigInt(whole).toLocaleString(locale);
  } catch { /* noop */ }
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${wholeText}${decimal}${trimmed}` : wholeText;
}

/** Anteil in Prozent fuer die Anzeige (max. 4 Nachkommastellen). */
export function formatSharePercent(value, locale) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
  } catch {
    return String(value);
  }
}
