// Gebuehren-Strategie (Backlog P1.6).
//
// Bei Netzlast (Surge Pricing) zahlen alle Transaktionen eines Ledgers denselben Satz pro
// Operation: den niedrigsten Satz, der noch aufgenommen wurde - nicht das eigene Gebot
// (CAP-5). Ohne Netzlast zahlt jede Transaktion nur die Basisgebuehr (100 Stroops).
// Die Gebuehr im TransactionBuilder ist also eine Obergrenze. Ein hoeheres Gebot kostet
// nur dann mehr, wenn das Netz wirklich voll ist, und verhindert dann tx_insufficient_fee.
//
// Stufen:
// - normal: wie bisher, max(Basisgebuehr, haeufigste gezahlte Gebuehr)
// - fast:   zusaetzlich p95 der gezahlten Gebuehren und mindestens 10x Basisgebuehr
//
// Transaktionen, die erst spaeter eingereicht werden (Multisig-Jobs, XDR-Export), bieten
// immer mindestens 'fast': Ihre Gebuehr ist nach dem Signieren fest, die Netzlast zum
// Einreichzeitpunkt (bis zu 7 Tage spaeter) ist heute nicht absehbar.

export const FEE_LEVELS = ['normal', 'fast'];
export const DEFAULT_FEE_LEVEL = 'normal';
export const FEE_LEVEL_STORAGE_KEY = 'stm.feeLevel';
export const MIN_FEE_STROOPS = 100;
export const FAST_BASE_MULTIPLIER = 10;
// 0.01 XLM pro Operation: Schutz gegen Ausreisser in den feeStats.
export const MAX_FEE_STROOPS = 100000;

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeFeeLevel(level) {
  return FEE_LEVELS.includes(level) ? level : DEFAULT_FEE_LEVEL;
}

export function getStoredFeeLevel() {
  try {
    return normalizeFeeLevel(window.localStorage?.getItem(FEE_LEVEL_STORAGE_KEY));
  } catch {
    return DEFAULT_FEE_LEVEL;
  }
}

export function setStoredFeeLevel(level) {
  try {
    window.localStorage?.setItem(FEE_LEVEL_STORAGE_KEY, normalizeFeeLevel(level));
  } catch { /* noop */ }
}

// Gebuehr pro Operation in Stroops (String, wie TransactionBuilder sie erwartet).
export function computeFeePerOp(feeStats, level = DEFAULT_FEE_LEVEL) {
  // Auch die Basisgebuehr wird gedeckelt, damit ein abweichender feeStats-Wert nicht ungebremst durchgeht.
  const base = Math.min(MAX_FEE_STROOPS, Math.max(MIN_FEE_STROOPS, positiveNumber(feeStats?.last_ledger_base_fee)));
  let fee = Math.max(base, positiveNumber(feeStats?.fee_charged?.mode));
  if (normalizeFeeLevel(level) === 'fast') {
    fee = Math.max(fee, positiveNumber(feeStats?.fee_charged?.p95), base * FAST_BASE_MULTIPLIER);
  }
  return String(Math.max(base, Math.min(Math.ceil(fee), MAX_FEE_STROOPS)));
}

// Holt die aktuellen feeStats und berechnet die Gebuehr. Wirft nie: Faellt Horizon aus,
// wird mit der Basisgebuehr der gewaehlten Stufe gerechnet.
// deferred = true fuer alles, was nicht sofort eingereicht wird (Multisig-Job, XDR-Export).
export async function resolveFeePerOp(server, { deferred = false, level } = {}) {
  const effectiveLevel = deferred ? 'fast' : normalizeFeeLevel(level || getStoredFeeLevel());
  let feeStats = null;
  try {
    feeStats = await server.feeStats();
  } catch (e) {
    console.warn('[SKM] feeStats unavailable, using base fee', e);
  }
  return computeFeePerOp(feeStats, effectiveLevel);
}
