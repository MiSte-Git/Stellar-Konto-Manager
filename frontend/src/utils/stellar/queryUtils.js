// SKM_VER:queryUtils.js@2025-09-10
// Live Horizon-Scans (kein Cache/IndexedDB) für die "XLM nach Memo"-Suche.
// Sichtbare Vergleichsnormierung: entferne unsichtbare Zeichen + trim, Case bleibt erhalten
// Built from numeric code points (not a regex literal) to strip zero-width
// chars (ZWSP/ZWNJ/ZWJ/BOM) from memo comparisons.
// eslint-disable-next-line no-misleading-character-class -- see above, false positive on a dynamically-built pattern
const ZERO_WIDTH_RE = new RegExp('[' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff) + ']', 'g');
const cleanMemo = (s) => String(s ?? '').replace(ZERO_WIDTH_RE, '').trim();

// Erlaubte Operationstypen (nur Zahlungen)
const PAY_TYPES = new Set([
  'payment',
  'path_payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

/** Tally für identische Zählweise */
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

// Retry-Helfer gegen temporäre Horizon-Fehler (z. B. 500, 429). Exportiert,
// damit XlmByMemoPanel.jsx dieselbe Absicherung auch für seine eigenen
// Horizon-Scans (Export/Falsche Memos/Top 20) nutzen kann statt sie erneut
// zu implementieren.
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
export async function withRetry(fn, { tries = 4, baseDelay = 400 } = {}) {
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
