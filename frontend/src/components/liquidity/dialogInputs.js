import { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS } from '../../utils/stellar/liquidityPools.js';

const PERCENT_RE = /^\d+(?:\.\d{1,2})?$/;

/**
 * Slippage-Eingabe in Prozent ('0,5', '1', '5') -> Basispunkte. Gueltig sind
 * 0.1 bis 5 % (10..500 bps). Ungueltige Eingaben werden nicht still
 * korrigiert, sondern als ungueltig gemeldet.
 */
export function parseSlippagePercent(value) {
  const str = String(value ?? '').trim().replace(',', '.');
  if (!PERCENT_RE.test(str)) return { valid: false, bps: DEFAULT_SLIPPAGE_BPS };
  const [whole, frac = ''] = str.split('.');
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (bps < MIN_SLIPPAGE_BPS || bps > MAX_SLIPPAGE_BPS) return { valid: false, bps };
  return { valid: true, bps };
}

const WITHDRAW_PERCENT_RE = /^\d+(?:[.,]\d{1,2})?$/;

/** Prozent (max. 2 Nachkommastellen) -> Shares, abgerundet; 100 % ergibt exakt den Bestand. */
export function sharesFromPercent(balance, percentInput) {
  const str = String(percentInput ?? '').trim();
  if (!WITHDRAW_PERCENT_RE.test(str)) return null;
  const [whole, frac = ''] = str.replace(',', '.').split('.');
  const hundredths = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  if (hundredths <= 0n || hundredths > 10000n) return null;
  return hundredths === 10000n ? balance : (balance * hundredths) / 10000n;
}
