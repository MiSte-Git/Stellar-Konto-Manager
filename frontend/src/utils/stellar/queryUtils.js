// STM_VER:queryUtils.js@2025-09-10
// Lokale Abfragen auf IndexedDB (ms-schnell)
import { iterateByAccountMemoRange, getPaymentsByRangeAndMemo, backfillMemoNorm, iterateByAccountCreatedRange } from '../db/indexedDbClient';
const normMemo = (s) => String(s||'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().replace(/\s+/g,' ').toUpperCase();

/**
 * Summiert XLM aus lokalem Cache nach Memo & Zeitraum.
 * @returns {Promise<number>}
 */

// Erlaubte Operationstypen (nur Zahlungen)
const PAY_TYPES = new Set([
  'payment',
  'path_payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

/** true, wenn eingehende native XLM-Zahlung */
function isIncomingNativePayment(rec, accountId) {
  const t = String(rec.type || '');
  if (!PAY_TYPES.has(t)) return false;
  if (rec.to !== accountId) return false;
  if (rec.asset_type !== 'native') return false;
  const amt = Number.parseFloat(rec.amount || '0');
  return Number.isFinite(amt) && amt > 0;
}

/** Exaktes, case-sensitives Transaktions-Memo lesen (ohne Normalisierung) */
function getExactTxMemo(rec) {
  // /operations?join=transactions → memo steht i.d.R. in rec.transaction.memo
  if (rec?.memo != null) return String(rec.memo);
  if (rec?.transaction_memo != null) return String(rec.transaction_memo);
  if (rec?.transaction?.memo != null) return String(rec.transaction.memo);
  return '';
}

/** Tally für identische Zählweise in beiden Pfaden */
function createTally() {
  return {
    totalCount: 0,     // alle eingehenden Zahlungen (ohne Memo-Filter)
    totalAmount: 0,
    matchCount: 0,     // korrekte Memos
    matchAmount: 0,
    otherCount: 0,     // andere/kein Memo
    uniqueSendersMatch: new Set(), // eindeutige Absender innerhalb der Treffer
    uniqueSendersAll:   new Set(), // eindeutige Absender aller Eingänge
    uniqueSendersOther: new Set(), // eindeutige Absender anderer/kein Memo
  };
}

// true, wenn eingehende native XLM-Zahlung (payment oder path_payment_*).
function isIncomingNative(rec, accountId) {
  // Keine Typprüfung nötig; robust über Feldstruktur
  if (rec.to !== accountId) return false;
  if (rec.asset_type !== 'native') return false;
  const amt = Number.parseFloat(rec.amount || '0');
  return Number.isFinite(amt) && amt > 0;
}

// true, wenn es ein erlaubter eingehender XLM-Eingang ist
function classifyIncomingOp(rec, accountId) {
  const t = String(rec.type || '');
  const isPayment = t === 'payment' || t === 'path_payment_strict_receive' || t === 'path_payment_strict_send';
  const isCreate  = t === 'create_account';

  if (isPayment) {
    if (rec.asset_type !== 'native') return null;
    if (rec.to !== accountId) return null;
    return { amount: Number.parseFloat(rec.amount || '0') || 0, sender: rec.from };
  }
  if (isCreate) {
    if (rec.account !== accountId) return null;
    return { amount: Number.parseFloat(rec.starting_balance || '0') || 0, sender: rec.funder };
  }
  return null;
}

/**
 * Kaltlauf: /operations + join('transactions'), exakter Memo-Vergleich.
 * Zählt nur payment/path_payment_*, obere Grenze exklusiv.
 */
export async function sumIncomingXLMByMemoNoCacheExact({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal
}) {
   
  return await sumIncomingXLMByMemoNoCacheExact_TxFirst({
      server, accountId, memoQuery, fromISO, toISO, onProgress, signal
  });
}

/**
 * Fallback: Tx-first. Holt nur Transaktionen mit exakt passendem Memo und
 * zählt dann deren Zahlungs-Operationen.
 */
/**
 * Tx-First: Holt nur Transaktionen mit exakt passendem Memo im Zeitfenster
 * und summiert dann die eingehenden nativen Payments dieser Transaktionen.
 * Parallelisiert die Payments-Fetches je Transaktion (schonend limitiert).
 */
export async function sumIncomingXLMByMemoNoCacheExact_TxFirst({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal
}) {
  const q = String(memoQuery ?? '');
  const tally = createTally();

  // 1) Transaktionen des Accounts im Zeitfenster scannen und nach Memo filtern
  let txPage = await server
    .transactions()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .call();

  let stop = false, pages = 0;
  const hitTx = [];

  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const txs = txPage?.records || [];
    for (const tx of txs) {
      const created = tx.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created <  fromISO) { stop = true; break; }

      const memo = tx?.memo != null ? String(tx.memo) : '';
      if (memo === q) hitTx.push(tx.hash);
    }

    if (stop || !txPage.next) break;
    pages += 1;
    onProgress?.({ phase: 'scan_tx', pagesTx: pages });
    txPage = await txPage.next();
  }

  // 2) Für jede Treffer-Transaktion nur deren Payments laden (parallelisiert)
  const limit = 6;                   // Parallelität, Horizon-schonend
  let done = 0;

  async function processTx(hash) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const page = await server.payments().forTransaction(hash).limit(200).call();
    const pays = page?.records || [];

    for (const r of pays) {
      if (!isIncomingNativePayment(r, accountId)) continue;
      const amt = Number.parseFloat(r.amount || '0');
      if (!Number.isFinite(amt) || amt <= 0) continue;

      tally.totalCount  += 1;
      tally.totalAmount += amt;
      tally.matchCount  += 1;
      tally.matchAmount += amt;

      if (r.from) {
        tally.uniqueSendersMatch.add(r.from);
        tally.uniqueSendersAll.add(r.from);
      }
    }

    done += 1;
    if (done % 10 === 0) onProgress?.({ phase: 'scan_tx', fetched: done, total: hitTx.length });
  }

  const queue = [...hitTx];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      await processTx(next);
    }
  });
  await Promise.all(runners);

  // 3) Abschluss für UI
  onProgress?.({
    phase: 'finalize',
    matches: tally.matchCount,
    incomingOverview: {
      total: tally.totalCount,
      totalAmount: tally.totalAmount,
      unique: tally.uniqueSendersMatch.size,
      uniqueAll: tally.uniqueSendersAll.size,
      otherTotal: 0,
    },
  });

  return {
    amount: tally.matchAmount,
    hits: tally.matchCount,
    walletsCount: tally.uniqueSendersMatch.size,
    otherCount: 0,
    totalCount: tally.totalCount,
    totalAmount: tally.totalAmount,
    uniqueAll: tally.uniqueSendersAll.size,
  };
}


/**
 * Diagnostik ohne Cache: Zählt eingehende native XLM (inkl. create_account) im Zeitraum
 * und teilt nach Memo-Kategorie auf: exakt passend, anderes Memo, kein Memo.
 * Nutzt Horizon + join('transactions'), bricht am fromISO-Rand ab.
 */
export async function diagnoseIncomingByMemoNoCache({ server, accountId, memoQuery, fromISO, toISO, onProgress, signal }) {
  const q = normMemo(memoQuery || '');
  const res = {
    total:     { count: 0, amount: 0 },
    match:     { count: 0, amount: 0 },
    otherMemo: { count: 0, amount: 0 },
    noMemo:    { count: 0, amount: 0 },
  };
  const toNum = (s)=>{ const n=parseFloat(s); return Number.isFinite(n)?n:0; };
  const isNative = (r)=> !r.asset_type || r.asset_type === 'native';
  const isPayOp  = (r)=> r.type === 'payment' || String(r.type||'').startsWith('path_payment');
  const add = (k, amt)=>{ res[k].count++; res[k].amount += amt; res.total.count++; res.total.amount += amt; };

  let page = await server
    .payments()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .join('transactions')
    .call();

  let stop = false, pageNo = 0;
  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const recs = page?.records || [];
    for (const r of recs) {
      const created = r.created_at || r?.transaction?.created_at || '';
      if (toISO && created > toISO) continue;
      if (fromISO && created < fromISO) { stop = true; break; }

      let amt = 0;
      if (isPayOp(r) && r.to === accountId && isNative(r)) amt = toNum(r.amount);
      else if (r.type === 'create_account' && r.account === accountId) amt = toNum(r.starting_balance);
      if (amt <= 0) continue;

      const memoRaw = String(r.memo ?? r?.transaction?.memo ?? '').trim();
      if (!memoRaw) add('noMemo', amt);
      else if (normMemo(memoRaw) === q) add('match', amt);
      else add('otherMemo', amt);
    }

    if (stop || !page.next) break;
    pageNo += 1;
    onProgress?.({ phase: 'scan', page: pageNo });
    page = await page.next();
  }

  onProgress?.({ phase: 'finalizeDiag', diag: res });
  return res;
}

