import { fromStroops, toStroops } from '../../utils/stellar/liquidityPools.js';

/**
 * Stroops (BigInt) -> lokalisierte Anzeige ohne Float-Umweg: Tausender-
 * Trennung ueber BigInt.toLocaleString, Nachkommastellen ohne Nullen am Ende,
 * aber immer mindestens eine. Ohne Nachkommastelle waere "1.111" (de) nicht von
 * 1,111 (en) zu unterscheiden; mit "1.111,0" bzw. "1’111.0" (de-CH) steht der
 * Dezimaltrenner immer da und der Tausendertrenner ist eindeutig.
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
  const trimmed = frac.replace(/0+$/, '') || '0';
  return `${wholeText}${decimal}${trimmed}`;
}

/** Betrag mit Einheit, z. B. "1.111,0 XLM" oder "5,0 USD:GA5ZSEJY...34K4KZVN". */
export function formatAmountWithUnit(stroops, unit, locale) {
  return `${formatPoolAmount(stroops, locale)} ${unit}`;
}

/** Anteil in Prozent fuer die Anzeige (max. 4 Nachkommastellen). */
export function formatSharePercent(value, locale) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Preis { n, d } fuer die Anzeige (7 signifikante Stellen). invert zeigt d/n,
 * z. B. fuer die Nutzerreihenfolge B/A. Nur Anzeige: die Grenzen selbst
 * bleiben als exakte Brueche erhalten.
 */
export function formatPrice(price, locale, invert = false) {
  if (!price || !price.n || !price.d) return '—';
  return formatPriceDecimal(invert ? price.d / price.n : price.n / price.d, locale);
}

/**
 * Preis als Zahl oder Dezimal-String (z. B. '0.0995049' oder '3.3e-9', wie das
 * SDK minPrice/maxPrice dekodiert) fuer die Anzeige, 7 signifikante Stellen.
 */
export function formatPriceDecimal(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  try {
    return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(num);
  } catch {
    return String(num);
  }
}

/** Slippage in Basispunkten -> Prozent fuer die Anzeige (50 -> '0,5'). */
export function formatSlippage(bps, locale) {
  const value = Number(bps) / 100;
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  } catch {
    return String(value);
  }
}

const AMOUNT_INPUT_RE = /^\d+(?:\.\d{1,7})?$/;

/** Nutzereingabe ('1,5' oder '1.5', max. 7 Nachkommastellen) -> Stroop-BigInt oder null. */
export function parseAmountInput(value) {
  const str = String(value ?? '').trim().replace(',', '.');
  if (!AMOUNT_INPUT_RE.test(str)) return null;
  return toStroops(str);
}
