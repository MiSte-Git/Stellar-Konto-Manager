// Lokale Abfragen auf IndexedDB (ms-schnell)
import { getPaymentsByRangeAndMemo } from '../db/indexedDbClient';

/**
 * Summiert XLM aus lokalem Cache nach Memo & Zeitraum.
 * @returns {Promise<number>}
 */
export async function sumIncomingXLMByMemoCached({ accountId, memoQuery, fromISO, toISO, onProgress }) {
  if (typeof memoQuery !== 'string' || memoQuery.length === 0) {
    throw new Error('error.query.invalidMemo');
  }
  if (fromISO && toISO && new Date(fromISO) > new Date(toISO)) {
    throw new Error('error.query.invalidRange');
  }
  onProgress?.({ phase: 'cacheQuery', progress: 0 });
  const records = await getPaymentsByRangeAndMemo(accountId, { fromISO, toISO, memo: memoQuery });
  let total = 0, scanned = 0, matches = 0;
  for (const r of records) {
    scanned++;
    // Eingänge in native Asset (XLM) an unser Wallet
    if ((r.asset_type === 'native' || r.asset_type === null) && r.to) {
      const amt = parseFloat(r.amount || '0');
      if (Number.isFinite(amt)) {
        total += amt; matches++;
      }
    }
    if (scanned % 50 === 0) onProgress?.({ phase: 'cacheQuery', progress: scanned / records.length });
  }
  onProgress?.({ phase: 'finalize', progress: 1 });
  return total;
}
