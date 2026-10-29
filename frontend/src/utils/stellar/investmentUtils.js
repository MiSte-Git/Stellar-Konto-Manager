import * as StellarSdk from '@stellar/stellar-sdk';
import { NETWORKS } from '../../config/networks.js';
import { HORIZON_URL } from '../../config';
import { getHorizonServer } from './stellarUtils';
import { ensureCoverage } from './syncUtils';
import { iterateByAccountCreatedRange, getOldestCreatedAt, getNewestCreatedAt, rehydrateEmptyMemos } from '../db/indexedDbClient';

// Simple retry helper to handle transient Horizon errors (429/5xx)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function withRetry(fn, { tries = 4, baseDelay = 400, signal } = {}) {
  let attempt = 0, lastErr;
  while (attempt < tries) {
    if (signal?.aborted) {
      const err = new Error('withRetry.aborted');
      err.isAborted = true;
      throw err;
    }
    try {
      const res = await fn();
      return res;
    } catch (e) {
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
 * Macht aus einem beliebigen Fehler (Horizon/SDK, fetch, eigene Errors) einen lesbaren String
 * für {{detail}}: HTTP-Status, Horizon-Titel/-Detail, extras.result_codes, sonst error.message.
 * Liefert nie ein Objekt oder undefined.
 */
export function describeHorizonError(e) {
  try {
    if (e == null) return 'unknown';
    if (typeof e === 'string') return e || 'unknown';
    const resp = e.response || null;
    const status = resp?.status || e.status || 0;
    // stellar-sdk: e.response ist direkt der Horizon-Body ({ title, status, extras }); axios-artig: e.response.data
    const data = resp?.data && typeof resp.data === 'object' ? resp.data : (resp && typeof resp === 'object' ? resp : null);
    const parts = [];
    if (status) parts.push(`HTTP ${status}`);
    const title = data?.title || '';
    if (title) parts.push(String(title));
    const codes = data?.extras?.result_codes;
    if (codes) parts.push(typeof codes === 'string' ? codes : JSON.stringify(codes));
    const msg = typeof e.message === 'string' ? e.message.trim() : '';
    if (msg && !parts.some((p) => p.includes(msg))) parts.push(msg);
    if (!parts.length && data?.detail) parts.push(String(data.detail));
    return parts.join(' – ') || String(e) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Erstellungsdatum eines Kontos aus der ersten verfügbaren Operation (order=asc, limit=1).
 * Nur wenn diese ein create_account mit dem Konto als Ziel ist, ist sie die Erstellung.
 * Sonst liegt die Erstellung vor der Horizon-History-Grenze → '' (unbekannt); die erste
 * gefundene Operation wird bewusst nicht als Ersatz verwendet. Kein Weiterblättern.
 */
export async function fetchAccountCreatedAt({ server, publicKey }) {
  if (!publicKey) return '';
  const page = await server.operations().forAccount(publicKey).order('asc').limit(1).cursor('1').call();
  const first = page?.records?.[0];
  if (first?.type === 'create_account' && first.account === publicKey) return first.created_at || '';
  return '';
}

/** Wirft den einheitlichen Ladefehler; detail ist immer ein String. */
function throwFetchFailed(e) {
  const prefix = 'fetchInvestedTokens.failed:';
  const raw = e?.message || '';
  if (raw.startsWith(prefix)) throw e;
  const err = new Error(prefix + describeHorizonError(e));
  err.detail = describeHorizonError(e);
  err.isAborted = !!e?.isAborted || /aborted/i.test(raw);
  err.cause = e;
  throw err;
}

/**
 * Zählt AUSGEHENDE XLM-Zahlungen mit Memo (Groupfund) und summiert XLM je Memo.
 * Mehrfachzahlungen mit gleichem Memo werden als EIN Investment gezählt.
 */
export async function fetchGroupfundByMemo({
  publicKey,
  horizonUrl = HORIZON_URL || NETWORKS.PUBLIC.horizonUrl,
  limitPages = 2000,
  fromISO,
  toISO,
  onProgress,
  signal,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens:error.missingPublicKey');

    const server = getHorizonServer(horizonUrl);
    const memoGroups = new Map(); // memo -> { count, totalXlm, firstTx, firstCreatedAt, destinations: Map(addr->count) }
    const t0 = Date.now();

    // Scanne Payments-Feed (desc) und lese Memos via eingebetteter TX (join) – Cursor-basiert
    let builder = server
      .payments()
      .forAccount(publicKey)
      .order('desc')
      .limit(200)
      .join('transactions');
    let page = await withRetry(() => builder.call(), { signal });
    let lastCursor = null;
    const seenCursors = new Set();

    let pagesSeen = 0;

    let lastOldest = '';
    let stopEarly = false;
    // Ausgehende XLM-Payments, zu denen der join keine Transaktionsdaten geliefert hat
    let joinMissing = 0;
    while (!stopEarly) {
      if (signal?.aborted) throw new Error('fetch.groupfund.aborted');
      const recs = page?.records || [];
      if (recs.length === 0) { break; }
      for (const rec of recs) {
        const type = rec.type || '';
        const created = rec.created_at || '';
        // Obere Grenze: zu neu → überspringen (Seite weiter scannen, DESC-Reihenfolge)
        if (toISO && created && created >= toISO) continue;
        // Untere Grenze: zu alt → Abbruch (alle folgenden Records + Seiten sind noch älter)
        if (fromISO && created && created < fromISO) { stopEarly = true; break; }
        // Nur ausgehende Zahlungen vom eigenen Konto berücksichtigen
        const fromAddr = rec.from || (type === 'create_account' ? rec.funder : null);
        if (fromAddr !== publicKey) continue;
        // Nur native (XLM) bzw. create_account
        const isNative = rec.asset_type === 'native' || type === 'create_account';
        if (!isNative) continue;
        // Memo aus eingebetteter TX lesen. Das stellar-sdk macht aus dem Link `transaction`
        // eine Lazy-Funktion; die per join eingebetteten Daten liegen in `transaction_attr`.
        const txAttr = rec?.transaction_attr
          || (rec?.transaction && typeof rec.transaction === 'object' ? rec.transaction : null);
        if (!txAttr && rec?.transaction_memo == null) { joinMissing += 1; continue; }
        const memoRaw = txAttr?.memo != null
          ? String(txAttr.memo)
          : (rec?.transaction_memo != null ? String(rec.transaction_memo) : '');
        const memo = memoRaw.trim();
        if (!memo) continue;

        const amountXlm = parseFloat(type === 'create_account' ? (rec.starting_balance || '0') : (rec.amount || '0')) || 0;
        const txHash = rec.transaction_hash || '';
        const createdAt = created || null;
        let destAddr = null;
        if (type === 'create_account') destAddr = rec.account || null; else destAddr = rec.to || rec.to_muxed || null;

        const g = memoGroups.get(memo);
        if (!g) {
          const dests = new Map();
          if (destAddr) dests.set(destAddr, 1);
          memoGroups.set(memo, { count: 1, totalXlm: amountXlm, firstTx: txHash, firstCreatedAt: createdAt, destinations: dests });
        } else {
          g.count += 1;
          g.totalXlm += amountXlm;
          if (destAddr) g.destinations.set(destAddr, (g.destinations.get(destAddr) || 0) + 1);
        }
      }

      pagesSeen += 1;
      const oldestOnPage = recs[recs.length - 1]?.created_at || '';
      lastOldest = oldestOnPage;
      onProgress?.({ phase: 'scan_payments', page: pagesSeen, elapsedMs: Date.now() - t0, oldestOnPage });
      if (stopEarly) break;
      if (pagesSeen >= limitPages) break;

      // Cursor bestimmen und nächste Seite holen. Leere Seite = Ende der verfügbaren
      // Horizon-History (kein Fehler). Echte Fehler (Netz, Timeout, 429/5xx nach Retries)
      // werden nicht verschluckt, sondern mit Detail gemeldet.
      const nextCursor = recs[recs.length - 1]?.paging_token || null;
      if (!nextCursor || nextCursor === lastCursor || seenCursors.has(nextCursor)) { break; }
      seenCursors.add(nextCursor);
      lastCursor = nextCursor;
      builder = server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .cursor(nextCursor)
        .join('transactions');
      page = await withRetry(() => builder.call(), { signal });
    }

    // Fallback TX-First nur als Sicherheitsnetz, wenn der join für ausgehende Payments keine
    // Transaktionsdaten geliefert hat. Teuer: ein Request je Memo-Transaktion (→ Horizon-Rate-Limit).
    if (joinMissing > 0) {
      onProgress?.({ phase: 'fallback_tx', page: pagesSeen, oldestOnPage: lastOldest });
      // 1) Transaktionen rückwärts scannen und Memos einsammeln
      let txPage = await withRetry(() => server.transactions().forAccount(publicKey).order('desc').limit(200).call(), { signal });
      let stopTx = false; let txPages = 0;
      const hits = [];
      while (!stopTx) {
        const txs = txPage?.records || [];
        if (!txs.length) break;
        for (const tx of txs) {
          const created = tx.created_at || '';
          if (toISO && created >= toISO) continue;
          if (fromISO && created < fromISO) { stopTx = true; break; }
          const memo = tx?.memo != null ? String(tx.memo).trim() : '';
          if (memo) hits.push({ hash: tx.hash, memo, created });
        }
        if (stopTx || !txPage.next) break;
        txPages += 1;
        if (txPages % 5 === 0) onProgress?.({ phase: 'scan_tx', pagesTx: txPages, hitsTx: hits.length });
        if (signal?.aborted) throw new Error('fetch.groupfund.aborted');
        txPage = await withRetry(() => txPage.next(), { signal });
      }
      // 2) Für jede Treffer-Tx payments laden und ausgehende native zählen
      const limit = 6; let done = 0;
      let firstTxError = null;
      const q = [...hits];
      const workers = Array.from({ length: Math.min(limit, q.length) }, async () => {
        while (q.length) {
          const h = q.shift();
          try {
            if (signal?.aborted) throw new Error('fetch.groupfund.aborted');
            const p = await withRetry(() => server.payments().forTransaction(h.hash).limit(200).call(), { signal });
            const pays = p?.records || [];
            for (const rec of pays) {
              const type = rec.type || '';
              const fromAddr = rec.from || (type === 'create_account' ? rec.funder : null);
              if (fromAddr !== publicKey) continue;
              const isNative = rec.asset_type === 'native' || type === 'create_account';
              if (!isNative) continue;
              const amountXlm = parseFloat(type === 'create_account' ? (rec.starting_balance || '0') : (rec.amount || '0')) || 0;
              const destAddr = type === 'create_account' ? (rec.account || null) : (rec.to || rec.to_muxed || null);
              const g = memoGroups.get(h.memo);
              if (!g) {
                const dests = new Map();
                if (destAddr) dests.set(destAddr, 1);
                memoGroups.set(h.memo, { count: 1, totalXlm: amountXlm, firstTx: rec.transaction_hash || h.hash, firstCreatedAt: rec.created_at || h.created, destinations: dests });
              } else {
                g.count += 1; g.totalXlm += amountXlm; if (destAddr) g.destinations.set(destAddr, (g.destinations.get(destAddr) || 0) + 1);
              }
            }
          } catch (e) {
            // Nicht still verschlucken: sonst wäre das Ergebnis unbemerkt unvollständig
            if (!firstTxError) firstTxError = e;
            q.length = 0;
          }
          done += 1;
          if (done % 10 === 0) onProgress?.({ phase: 'scan_payments', page: pagesSeen + Math.ceil(done / 10), elapsedMs: Date.now() - t0 });
          }
          });
          // Warten, aber bei Abbruch schnell raus
            await Promise.race([
         Promise.all(workers),
         new Promise((_, rej) => {
           if (signal) {
             const onAbort = () => rej(new Error('fetch.groupfund.aborted'));
             if (signal.aborted) onAbort();
             else signal.addEventListener('abort', onAbort, { once: true });
           }
         })
       ]);
      if (firstTxError) throw firstTxError;
     }

    const items = [...memoGroups.entries()].map(([memo, v]) => {
      const destArr = v.destinations ? [...v.destinations.entries()] : [];
      destArr.sort((a, b) => b[1] - a[1]);
      const uniqueDestinations = destArr.length;
      const topDestination = destArr[0] ? destArr[0][0] : null;
      return {
        type: 'memo',
        group: memo,
        occurrences: v.count,
        totalAmount: v.totalXlm,
        asset: 'XLM',
        sample: { tx: v.firstTx, created_at: v.firstCreatedAt || null },
        uniqueDestinations,
        topDestination,
        destinations: destArr.map(([addr, cnt]) => ({ address: addr, count: cnt })),
      };
    });

    return { mode: 'groupfundByMemo.livePayments', totalGroups: items.length, items };
  } catch (e) {
    throwFetchFailed(e);
  }
}

/**
 * Wie fetchGroupfundByMemo – aber nutzt lokalen Cache (IndexedDB) und ist dadurch deutlich schneller.
 * Stellt zuvor die Cache-Abdeckung sicher und rehydriert leere Memos im betrachteten Zeitraum.
 */
export async function fetchGroupfundByMemoCached({
  publicKey,
  horizonUrl = HORIZON_URL || NETWORKS.PUBLIC.horizonUrl,
  prefetchDays = 90,
  requiredFromISO,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens:error.missingPublicKey');
    const server = getHorizonServer(horizonUrl);

    // 1) Abdeckung sicherstellen (lädt fehlende Seiten in den lokalen Cache)
    await ensureCoverage({ server, accountId: publicKey, prefetchDays, requiredFromISO });

    // 2) Zeitfenster bestimmen (ganze Cache-Spanne)
    const fromISO = await getOldestCreatedAt(publicKey) || undefined;
    const toISO   = await getNewestCreatedAt(publicKey) || undefined;

    // 3) Leere Memos im Fenster nachziehen (gezielt, relativ günstig)
    await rehydrateEmptyMemos({ server, accountId: publicKey, fromISO, toISO });

    // 4) Lokal iterieren und gruppieren
    const memoGroups = new Map(); // memo -> { count, totalXlm, firstTx, destinations: Map(addr->count) }

    await iterateByAccountCreatedRange({
      accountId: publicKey,
      fromISO,
      toISO,
      onRow: (v) => {
        const type = v.type;
        // Ausgang vom eigenen Konto
        const isOutgoing = (v.from && v.from === publicKey) || (type === 'create_account' && v.source_account === publicKey);
        if (!isOutgoing) return;
        // Nur XLM
        const isNative = v.asset_type === 'native' || type === 'create_account';
        if (!isNative) return;
        // Memo lesen
        const memo = (v.memo || '').trim();
        if (!memo) return;
        // Betrag + Zieladresse
        const amountXlm = parseFloat(type === 'create_account' ? (v.starting_balance || '0') : (v.amount || '0')) || 0;
        const destAddr = type === 'create_account' ? (v.account || null) : (v.to || null);
        const txHash = v.transaction_hash || '';

        const g = memoGroups.get(memo);
        if (!g) {
          const dests = new Map();
          if (destAddr) dests.set(destAddr, 1);
          memoGroups.set(memo, { count: 1, totalXlm: amountXlm, firstTx: txHash, firstCreatedAt: (v.created_at || null), destinations: dests });
        } else {
          g.count += 1;
          g.totalXlm += amountXlm;
          if (destAddr) g.destinations.set(destAddr, (g.destinations.get(destAddr) || 0) + 1);
        }
      }
    });

    const items = [...memoGroups.entries()].map(([memo, v]) => {
      const destArr = v.destinations ? [...v.destinations.entries()] : [];
      destArr.sort((a, b) => b[1] - a[1]);
      const uniqueDestinations = destArr.length;
      const topDestination = destArr[0] ? destArr[0][0] : null;
      return {
        type: 'memo',
        group: memo,
        occurrences: v.count,
        totalAmount: v.totalXlm,
        asset: 'XLM',
        sample: { tx: v.firstTx, created_at: v.firstCreatedAt || null },
        uniqueDestinations,
        topDestination,
        destinations: destArr.map(([addr, cnt]) => ({ address: addr, count: cnt })),
      };
    });

    return { mode: 'groupfundByMemo.cache', totalGroups: items.length, items };
  } catch (e) {
    throwFetchFailed(e);
  }
}

/**
 * Ermittelt, in welche Token (Assets) du investiert hast und wieviel je Token.
 * - DEX-Trades des Accounts (gekaufte Mengen je Asset)
 * - Eingehende Asset-Payments an dein Konto (z. B. path payment receive)
 * Ergebnis: Map (CODE:ISSUER) -> totalBought (Stückzahl)
 */
export async function fetchInvestedPerToken({
  publicKey,
  horizonUrl = HORIZON_URL || NETWORKS.PUBLIC.horizonUrl,
  limitPages = 2000,
  onProgress,
  signal,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens:error.missingPublicKey');

    const server = getHorizonServer(horizonUrl);
    const totals = new Map(); // "CODE:ISSUER" -> number (gekaufte Menge)

    const t0 = Date.now();

    // --- (1) Trades des Accounts auswerten ---
    let tradesPage = await withRetry(() => server.trades().forAccount(publicKey).order('desc').limit(200).call(), { signal });
    let tradesPagesSeen = 0;

    while (tradesPage?.records?.length && tradesPagesSeen < limitPages) {
      if (signal?.aborted) throw new Error('fetch.tokens.aborted');
      for (const tr of tradesPage.records) {
        const isBaseParty = tr.base_account === publicKey;
        const isCounterParty = tr.counter_account === publicKey;
        let boughtCode = null;
        let boughtIssuer = null;
        let boughtAmount = 0;

        if (isBaseParty && tr.base_is_seller === false) {
          boughtCode = tr.base_asset_type === 'native' ? 'XLM' : tr.base_asset_code;
          boughtIssuer = tr.base_asset_type === 'native' ? null : tr.base_asset_issuer;
          boughtAmount = parseFloat(tr.base_amount || '0');
        } else if (isCounterParty && tr.base_is_seller === true) {
          boughtCode = tr.counter_asset_type === 'native' ? 'XLM' : tr.counter_asset_code;
          boughtIssuer = tr.counter_asset_type === 'native' ? null : tr.counter_asset_issuer;
          boughtAmount = parseFloat(tr.counter_amount || '0');
        }

        if (!boughtCode || boughtCode === 'XLM' || !boughtIssuer) continue;

        const key = `${boughtCode}:${boughtIssuer}`;
        totals.set(key, (totals.get(key) || 0) + boughtAmount);
      }

      tradesPagesSeen += 1;
      onProgress?.({ phase: 'scan_tx', page: tradesPagesSeen, elapsedMs: Date.now() - t0 });
      tradesPage = typeof tradesPage.next === 'function' ? await withRetry(() => tradesPage.next(), { signal }) : null;
    }

    // --- (2) Eingehende Asset-Payments an dich (z. B. path_payment_receive) ---
    let payPage = await withRetry(() => server.payments().forAccount(publicKey).order('desc').limit(200).call(), { signal });
    let payPagesSeen = 0;

    while (payPage?.records?.length && payPagesSeen < limitPages) {
      if (signal?.aborted) throw new Error('fetch.tokens.aborted');
      for (const rec of payPage.records) {
        const type = rec.type;
        const toAddr = rec.to || rec.to_muxed || (type === 'create_account' ? rec.account : null);
        if (toAddr !== publicKey) continue;

        const isNative = rec.asset_type === 'native' || type === 'create_account';
        if (isNative) continue;

        const code = rec.asset_code;
        const issuer = rec.asset_issuer;
        const amount = parseFloat(rec.amount || '0');
        if (!code || !issuer || !amount) continue;

        const key = `${code}:${issuer}`;
        totals.set(key, (totals.get(key) || 0) + amount);
      }

      payPagesSeen += 1;
      onProgress?.({ phase: 'scan_payments', page: payPagesSeen, elapsedMs: Date.now() - t0 });
      payPage = typeof payPage.next === 'function' ? await withRetry(() => payPage.next(), { signal }) : null;
    }

    // --- Ergebnis ---
    const items = [...totals.entries()].map(([tokenKey, total]) => ({
      type: 'token',
      group: tokenKey,
      totalAmount: total,
    }));

    return {
      mode: 'perToken',
      totalTokens: items.length,
      items,
    };
  } catch (e) {
    throwFetchFailed(e);
  }
}
