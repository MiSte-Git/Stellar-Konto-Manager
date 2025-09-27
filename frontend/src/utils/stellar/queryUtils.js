// STM_VER:queryUtils.js@2025-09-10
// Lokale Abfragen auf IndexedDB (ms-schnell)
// Sichtbare Vergleichsnormierung: entferne unsichtbare Zeichen + trim, Case bleibt erhalten
const cleanMemo = (s) => String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

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

// Retry-Helfer gegen temporäre Horizon-Fehler (z. B. 500, 429)
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
async function withRetry(fn, { tries = 4, baseDelay = 400 } = {}) {
  let attempt = 0, lastErr;
  while (attempt < tries) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const status = e?.response?.status || e?.status || 0;
      if (status && status !== 429 && status >= 400 && status < 500) break;
      await sleep(baseDelay * Math.pow(2, attempt));
      attempt++;
    }
  }
  throw lastErr;
}

/**
 * No-Cache, Payments-First: Scannt payments().forAccount().join('transactions')
 * und filtert EXAKT nach Memo. Zählt gleichzeitig alle eingehenden nativen Payments
 * (für die Vergleichsübersicht). Obere Grenze exklusiv.
 */
export async function sumIncomingXLMByMemoNoCacheExact_PaymentsFirst({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal, collectRow
}) {
  const q = String(memoQuery ?? '');
  const qClean = cleanMemo(q);
  const tally = createTally();
  const pending = []; // memolose Kandidaten → später Tx laden

  let page = await withRetry(() => server
    .payments()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .join('transactions')
    .call());

  let stop = false, pageNo = 0;
  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const recs = page?.records || [];
    for (const r of recs) {
      const created = r.created_at || r?.transaction?.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created <  fromISO) { stop = true; break; }

      // Alle eingehenden nativen Payments zählen (Vergleich)
      if (isIncomingNativePayment(r, accountId)) {
        const amt = Number.parseFloat(r.amount || '0');
        if (Number.isFinite(amt) && amt > 0) {
          tally.totalCount  += 1;
          tally.totalAmount += amt;
          if (r.from) tally.uniqueSendersAll.add(r.from);

          // Exaktes Memo prüfen (preferiere joined transaction.memo)
          const memoRaw = (r?.transaction?.memo != null ? String(r.transaction.memo) : (r.memo != null ? String(r.memo) : ''));
          const memoClean = cleanMemo(memoRaw);
          if (memoClean) {
            if (memoClean === qClean) {
              tally.matchCount  += 1;
              tally.matchAmount += amt;
              if (r.from) tally.uniqueSendersMatch.add(r.from);
              collectRow?.({
                created_at: r.created_at,
                tx_hash: r.transaction_hash,
                from: r.from || '',
                to: r.to || accountId,
                amount: r.amount,
                asset_type: r.asset_type,
                memo: memoRaw
              });
            }
          } else if (r.transaction_hash) {
            // Memo fehlt trotz join → später nachladen
            pending.push({
              created_at: r.created_at,
              tx_hash: r.transaction_hash,
              from: r.from || '',
              to: r.to || accountId,
              amount: r.amount,
              asset_type: r.asset_type,
              amt,
              fromAcc: r.from || ''
            });
          }
        }
      }
    }

    if (stop || !page.next) break;
    pageNo += 1;
    onProgress?.({ phase: 'scan_payments', page: pageNo });
    page = await withRetry(() => page.next());
  }

  // Fallback: fehlende Memos per Tx-Details nachladen (schonend parallel)
  if (pending.length) {
    const limit = Math.min(8, Math.max(2, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 6));
    let idx = 0;
    const worker = async () => {
      while (idx < pending.length) {
        if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');
        const cur = pending[idx++];
        try {
          const tx = await server.transactions().transaction(cur.tx_hash).call();
          const memoRaw = (tx?.memo != null ? String(tx.memo) : '');
          const memoClean = cleanMemo(memoRaw);
          if (memoClean === qClean) {
            tally.matchCount  += 1;
            tally.matchAmount += cur.amt;
            if (cur.fromAcc) tally.uniqueSendersMatch.add(cur.fromAcc);
            collectRow?.({
              created_at: cur.created_at,
              tx_hash: cur.tx_hash,
              from: cur.from,
              to: cur.to,
              amount: cur.amount,
              asset_type: cur.asset_type,
              memo: memoRaw
            });
          }
        } catch {/* ignore single tx errors */}
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
  }

  onProgress?.({
    phase: 'finalize',
    matches: tally.matchCount,
    incomingOverview: {
      total: tally.totalCount,
      totalAmount: tally.totalAmount,
      unique: tally.uniqueSendersMatch.size,
      uniqueAll: tally.uniqueSendersAll.size,
      otherTotal: Math.max(0, tally.totalCount - tally.matchCount),
    },
  });

  return {
    amount: tally.matchAmount,
    hits: tally.matchCount,
    walletsCount: tally.uniqueSendersMatch.size,
    otherCount: Math.max(0, tally.totalCount - tally.matchCount),
    totalCount: tally.totalCount,
    totalAmount: tally.totalAmount,
    uniqueAll: tally.uniqueSendersAll.size,
  };
}

export async function sumIncomingXLMByMemoNoCacheExact_PaymentsFirst_NoBackfill({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal, collectRow
}) {
  const q = String(memoQuery ?? '');
  const qClean = cleanMemo(q);
  const tally = createTally();

  let page = await withRetry(() => server
    .payments()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .join('transactions')
    .call());

  let stop = false, pageNo = 0;
  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const recs = page?.records || [];
    for (const r of recs) {
      const created = r.created_at || r?.transaction?.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created <  fromISO) { stop = true; break; }

      // Alle eingehenden nativen Payments zählen (Vergleich)
      if (isIncomingNativePayment(r, accountId)) {
        const amt = Number.parseFloat(r.amount || '0');
        if (Number.isFinite(amt) && amt > 0) {
          tally.totalCount  += 1;
          tally.totalAmount += amt;
          if (r.from) tally.uniqueSendersAll.add(r.from);

          // Exaktes Memo prüfen (preferiere joined transaction.memo)
          const memoRaw = (r?.transaction?.memo != null ? String(r.transaction.memo) : (r.memo != null ? String(r.memo) : ''));
          if (cleanMemo(memoRaw) === qClean) {
            tally.matchCount  += 1;
            tally.matchAmount += amt;
            if (r.from) tally.uniqueSendersMatch.add(r.from);
            collectRow?.({
              created_at: r.created_at,
              tx_hash: r.transaction_hash,
              from: r.from || '',
              to: r.to || accountId,
              amount: r.amount,
              asset_type: r.asset_type,
              memo: memoRaw
            });
          }
        }
      }
    }

    if (stop || !page.next) break;
    pageNo += 1;
    onProgress?.({ phase: 'scan_payments_fast', page: pageNo });
    page = await withRetry(() => page.next());
  }

  onProgress?.({
    phase: 'finalize',
    matches: tally.matchCount,
    incomingOverview: {
      total: tally.totalCount,
      totalAmount: tally.totalAmount,
      unique: tally.uniqueSendersMatch.size,
      uniqueAll: tally.uniqueSendersAll.size,
      otherTotal: Math.max(0, tally.totalCount - tally.matchCount),
    },
  });

  return {
    amount: tally.matchAmount,
    hits: tally.matchCount,
    walletsCount: tally.uniqueSendersMatch.size,
    otherCount: Math.max(0, tally.totalCount - tally.matchCount),
    totalCount: tally.totalCount,
    totalAmount: tally.totalAmount,
    uniqueAll: tally.uniqueSendersAll.size,
  };
}

/**
 * Kaltlauf: /operations + join('transactions'), exakter Memo-Vergleich.
 * Zählt nur payment/path_payment_*, obere Grenze exklusiv.
 */
// Standard: Payments-First (schneller)
export const sumIncomingXLMByMemoNoCacheExact =
  sumIncomingXLMByMemoNoCacheExact_PaymentsFirst;

/**
 * Tx-First: Holt nur Transaktionen mit exakt passendem Memo im Zeitfenster
 * und summiert dann die eingehenden nativen Payments dieser Transaktionen.
 * Parallelisiert die Payments-Fetches je Transaktion (schonend limitiert).
 */
export async function sumIncomingXLMByMemoNoCacheExact_TxFirst({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal, collectRow
}) {
  const q = String(memoQuery ?? '');
  const qClean = cleanMemo(q);
  const tally = createTally();

  // 1) Transaktionen des Accounts im Zeitfenster scannen und nach Memo filtern
  let txPage = await withRetry(() => server
    .transactions()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .call());

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
      if (cleanMemo(memo) === qClean) hitTx.push(tx.hash);
    }

    if (stop || !txPage.next) break;
    pages += 1;
    onProgress?.({ phase: 'scan_tx', pagesTx: pages });
    txPage = await withRetry(() => txPage.next());
  }

  // 2) Für jede Treffer-Transaktion nur deren Payments laden (parallelisiert)
  const limit = 6;                   // Parallelität, Horizon-schonend
  let done = 0;

  // Lädt Payments einer Treffer-Transaktion und sammelt (optional) CSV-Zeilen
  async function processTx(hash) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const page = await withRetry(() => server.payments().forTransaction(hash).limit(200).call());
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
      // CSV-Zeile bereitstellen (nur Treffer)
      collectRow?.({
        created_at: r.created_at,
        tx_hash: r.transaction_hash || hash,
        from: r.from || '',
        to: r.to || accountId,
        amount: r.amount,
        asset_type: r.asset_type,       // 'native'
        memo: q
      });
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
 * Hybrid: 1) Transaktionen im Zeitfenster nach Memo filtern → Set(tx_hash)
 *         2) Einmal payments().forAccount() im Zeitfenster scannen und nur
 *            Zahlungen mit transaction_hash ∈ Set zählen (incoming native)
 * Kein pro-Tx-Payments-Fetch; deutlich weniger Requests bei vielen Treffern.
 */
export async function sumIncomingXLMByMemoNoCacheExact_Hybrid({
  server, accountId, memoQuery, fromISO, toISO, onProgress, signal, collectRow
}) {
  const q = String(memoQuery ?? '');
  const qClean = cleanMemo(q);
  const tally = createTally();

  // Phase 1: Treffer-Transaktionen einsammeln (Tx mit exakt passendem Memo)
  const hit = new Set();
  let txPage = await withRetry(() => server
    .transactions()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .call());

  let stopTx = false, txPages = 0;
  while (!stopTx) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');
    const txs = txPage?.records || [];
    for (const tx of txs) {
      const created = tx.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created <  fromISO) { stopTx = true; break; }
      const memo = tx?.memo != null ? String(tx.memo) : '';
      if (cleanMemo(memo) === qClean) hit.add(tx.hash);
    }
    if (stopTx || !txPage.next) break;
    txPages += 1;
    if (txPages % 5 === 0) onProgress?.({ phase: 'scan_tx', pagesTx: txPages, hitsTx: hit.size });
    txPage = await withRetry(() => txPage.next());
  }

  // Phase 2: Alle eingehenden Operationen (payments + create_account) zählen
  let opPage = await withRetry(() => server
    .operations()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .call()); // bewusst kein join

  let stop = false, pages = 0;
  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');
    const recs = opPage?.records || [];
    for (const r of recs) {
      const created = r.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created <  fromISO) { stop = true; break; }

      const t = String(r.type || '');

      // Zahlungen (incoming native)
      if (PAY_TYPES.has(t)) {
        if ((r.asset_type || 'native') !== 'native') continue;
        if (r.to !== accountId) continue;
        const amt = Number.parseFloat(r.amount || '0');
        if (!Number.isFinite(amt) || amt <= 0) continue;

        // Gesamtsumme (alle Eingänge)
        tally.totalCount  += 1;
        tally.totalAmount += amt;
        if (r.from) tally.uniqueSendersAll.add(r.from);

        // Treffer (Tx-Hash matcht Set der korrekten Memos)
        if (hit.has(r.transaction_hash)) {
          tally.matchCount  += 1;
          tally.matchAmount += amt;
          if (r.from) tally.uniqueSendersMatch.add(r.from);
          collectRow?.({
            created_at: r.created_at,
            tx_hash: r.transaction_hash,
            from: r.from || '',
            to: r.to || accountId,
            amount: r.amount,
            asset_type: r.asset_type || 'native',
            memo: q,
          });
        }
        continue;
      }

      // Kontoerstellung (create_account) als Eingang berücksichtigen
      if (t === 'create_account') {
        if (r.account !== accountId) continue;
        const amt = Number.parseFloat(r.starting_balance || '0');
        if (!Number.isFinite(amt) || amt <= 0) continue;

        tally.totalCount  += 1;
        tally.totalAmount += amt;
        if (r.funder) tally.uniqueSendersAll.add(r.funder);

        if (hit.has(r.transaction_hash)) {
          tally.matchCount  += 1;
          tally.matchAmount += amt;
          if (r.funder) tally.uniqueSendersMatch.add(r.funder);
          collectRow?.({
            created_at: r.created_at,
            tx_hash: r.transaction_hash,
            from: r.funder || '',
            to: r.account || accountId,
            amount: r.starting_balance,
            asset_type: 'native',
            memo: q,
          });
        }
      }
    }

    if (stop || !opPage.next) break;
    pages += 1;
    if (pages % 5 === 0) onProgress?.({ phase: 'scan_ops', pages, hitsTx: hit.size, matches: tally.matchCount });
    opPage = await withRetry(() => opPage.next());
  }

  onProgress?.({
    phase: 'finalize',
    matches: tally.matchCount,
    incomingOverview: {
      total: tally.totalCount,
      totalAmount: tally.totalAmount,
      unique: tally.uniqueSendersMatch.size,
      uniqueAll: tally.uniqueSendersAll.size,
      otherTotal: Math.max(0, tally.totalCount - tally.matchCount),
    },
  });

  return {
    amount: tally.matchAmount,
    hits: tally.matchCount,
    walletsCount: tally.uniqueSendersMatch.size,
    otherCount: Math.max(0, tally.totalCount - tally.matchCount),
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
  const q = cleanMemo(memoQuery || '');
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

  let page = await withRetry(() => server
    .payments()
    .forAccount(accountId)
    .order('desc')
    .limit(200)
    .join('transactions')
    .call());

  let stop = false, pageNo = 0;
  while (!stop) {
    if (signal?.aborted) throw new Error('submitTransaction.failed:cache.backfill.aborted');

    const recs = page?.records || [];
    for (const r of recs) {
      const created = r.created_at || r?.transaction?.created_at || '';
      if (toISO && created >= toISO) continue;          // obere Grenze exklusiv
      if (fromISO && created < fromISO) { stop = true; break; }

      let amt = 0;
      if (isPayOp(r) && r.to === accountId && isNative(r)) amt = toNum(r.amount);
      else if (r.type === 'create_account' && r.account === accountId) amt = toNum(r.starting_balance);
      if (amt <= 0) continue;

      const memoRaw = String(r?.transaction?.memo ?? r.memo ?? '');
      const memoClean = cleanMemo(memoRaw);
      if (!memoClean) add('noMemo', amt);
      else if (memoClean === q) add('match', amt);
      else add('otherMemo', amt);
    }

    if (stop || !page.next) break;
    pageNo += 1;
    onProgress?.({ phase: 'scan', page: pageNo });
    page = await withRetry(() => page.next());
  }

  onProgress?.({ phase: 'finalizeDiag', diag: res });
  return res;
}