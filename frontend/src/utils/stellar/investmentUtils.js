import * as StellarSdk from '@stellar/stellar-sdk';
import { HORIZON_URL } from '../../config';
import { getHorizonServer } from './stellarUtils';
import { ensureCoverage } from './syncUtils';
import { iterateByAccountCreatedRange, getOldestCreatedAt, getNewestCreatedAt, rehydrateEmptyMemos } from '../db/indexedDbClient';

/** 
 * Zählt AUSGEHENDE XLM-Zahlungen mit Memo (Groupfund) und summiert XLM je Memo.
 * Mehrfachzahlungen mit gleichem Memo werden als EIN Investment gezählt.
 */
export async function fetchGroupfundByMemo({
  publicKey,
  horizonUrl = HORIZON_URL || 'https://horizon.stellar.org',
  limitPages = 2000,
  onProgress,
  signal,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens.error.missingPublicKey');

    const server = getHorizonServer(horizonUrl);
    const memoGroups = new Map(); // key: memo -> { count, totalXlm, firstTx, destinations: Map(address -> count) }

    // 1) Transaktionen mit NICHT-leerem Memo einsammeln (Tx-First)
    let txPage = await server.transactions().forAccount(publicKey).order('desc').limit(200).call();
    const hitTx = []; // { hash, memo }
    let pagesSeen = 0;
    const t0 = Date.now();

    while (txPage?.records?.length && pagesSeen < limitPages) {
      if (signal?.aborted) throw new Error('fetch.groupfund.aborted');
      for (const tx of txPage.records) {
        const memo = typeof tx.memo === 'string' ? tx.memo.trim() : (tx.memo ? String(tx.memo).trim() : '');
        if (memo) hitTx.push({ hash: tx.hash, memo });
      }
      pagesSeen += 1;
      onProgress?.({ phase: 'scan_tx', page: pagesSeen, hits: hitTx.length, elapsedMs: Date.now() - t0 });
      txPage = typeof txPage.next === 'function' ? await txPage.next() : null;
    }

    // 2) Für alle Treffer-Transaktionen ihre Payments laden und nur ausgehende XLM werten
    const limit = 6;
    let done = 0;
    const runners = [];

    const addOutgoingNative = (rec, memo) => {
      const type = rec.type;
      const fromAddr = rec.from || (type === 'create_account' ? rec.funder : null);
      if (fromAddr !== publicKey) return;
      const isNative = rec.asset_type === 'native' || type === 'create_account';
      if (!isNative) return;

      const amountXlm = parseFloat(type === 'create_account' ? (rec.starting_balance || '0') : (rec.amount || '0')) || 0;
      const txHash = rec.transaction_hash || '';
      let destAddr = null;
      if (type === 'create_account') destAddr = rec.account || null; else destAddr = rec.to || rec.to_muxed || null;

      const g = memoGroups.get(memo);
      if (!g) {
        const dests = new Map();
        if (destAddr) dests.set(destAddr, 1);
        memoGroups.set(memo, { count: 1, totalXlm: amountXlm, firstTx: txHash, destinations: dests });
      } else {
        g.count += 1;
        g.totalXlm += amountXlm;
        if (destAddr) g.destinations.set(destAddr, (g.destinations.get(destAddr) || 0) + 1);
      }
    };

    const queue = [...hitTx];
    for (let i = 0; i < Math.min(limit, queue.length); i++) {
      runners.push((async () => {
        while (queue.length) {
          if (signal?.aborted) throw new Error('fetch.groupfund.aborted');
          const next = queue.shift();
          try {
            const payPage = await server.payments().forTransaction(next.hash).limit(200).call();
            const pays = payPage?.records || [];
            for (const rec of pays) addOutgoingNative(rec, next.memo);
          } catch {
            // ignore single tx failures
          }
          done += 1;
          onProgress?.({ phase: 'scan_payments', page: done, total: hitTx.length, elapsedMs: Date.now() - t0 });
        }
      })());
    }
    await Promise.all(runners);

    // 3) Ergebnis bauen
    const items = [...memoGroups.entries()].map(([memo, v]) => {
      const destArr = v.destinations ? [...v.destinations.entries()] : [];
      destArr.sort((a, b) => b[1] - a[1]);
      const uniqueDestinations = destArr.length;
      const topDestination = destArr[0] ? destArr[0][0] : null;
      return {
        type: 'memo',
        group: memo,                 // Memo-Text
        occurrences: v.count,        // Anzahl Zahlungen mit diesem Memo
        totalAmount: v.totalXlm,     // Summe XLM für dieses Memo
        asset: 'XLM',                // immer XLM
        sample: { tx: v.firstTx },
        uniqueDestinations,
        topDestination,
        destinations: destArr.map(([addr, cnt]) => ({ address: addr, count: cnt })),
      };
    });

    return {
      mode: 'groupfundByMemo',
      totalGroups: items.length,
      items,
    };
  } catch (e) {
    const detail = e?.message || 'unknown';
    throw new Error('fetchInvestedTokens.failed:' + detail);
  }
}

/**
 * Wie fetchGroupfundByMemo – aber nutzt lokalen Cache (IndexedDB) und ist dadurch deutlich schneller.
 * Stellt zuvor die Cache-Abdeckung sicher und rehydriert leere Memos im betrachteten Zeitraum.
 */
export async function fetchGroupfundByMemoCached({
  publicKey,
  horizonUrl = HORIZON_URL || 'https://horizon.stellar.org',
  prefetchDays = 90,
  requiredFromISO,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens.error.missingPublicKey');
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
          memoGroups.set(memo, { count: 1, totalXlm: amountXlm, firstTx: txHash, destinations: dests });
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
        sample: { tx: v.firstTx },
        uniqueDestinations,
        topDestination,
        destinations: destArr.map(([addr, cnt]) => ({ address: addr, count: cnt })),
      };
    });

    return { mode: 'groupfundByMemo.cache', totalGroups: items.length, items };
  } catch (e) {
    const detail = e?.message || 'unknown';
    throw new Error('fetchInvestedTokens.failed:' + detail);
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
  horizonUrl = HORIZON_URL || 'https://horizon.stellar.org',
  limitPages = 2000,
  onProgress,
  signal,
}) {
  try {
    if (!publicKey) throw new Error('investedTokens.error.missingPublicKey');

    const server = getHorizonServer(horizonUrl);
    const totals = new Map(); // "CODE:ISSUER" -> number (gekaufte Menge)

    const t0 = Date.now();

    // --- (1) Trades des Accounts auswerten ---
    let tradesPage = await server.trades().forAccount(publicKey).order('desc').limit(200).call();
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
      tradesPage = typeof tradesPage.next === 'function' ? await tradesPage.next() : null;
    }

    // --- (2) Eingehende Asset-Payments an dich (z. B. path_payment_receive) ---
    let payPage = await server.payments().forAccount(publicKey).order('desc').limit(200).call();
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
      payPage = typeof payPage.next === 'function' ? await payPage.next() : null;
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
    const detail = e?.message || 'unknown';
    throw new Error('fetchInvestedTokens.failed:' + detail);
  }
}
