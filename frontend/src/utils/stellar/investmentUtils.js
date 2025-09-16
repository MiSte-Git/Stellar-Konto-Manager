import * as StellarSdk from '@stellar/stellar-sdk';
import { HORIZON_URL } from '../../config';
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
}) {
  try {
    if (!publicKey) throw new Error('investedTokens.error.missingPublicKey');

    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const memoGroups = new Map(); // key: memo -> { count, totalXlm, firstTx, destinations: Map(address -> count) }

    const txMemoCache = new Map(); // txHash -> memo

    let page = await server.payments().forAccount(publicKey).order('desc').limit(200).call();
    let pagesSeen = 0;

    while (page?.records?.length && pagesSeen < limitPages) {
      for (const rec of page.records) {
        const type = rec.type; // "payment", "path_payment_*", "create_account", ...
        // Nur AUSGÄNGE (vom eigenen Konto gesendet)
        const fromAddr = rec.from || (type === 'create_account' ? rec.funder : null);
        if (fromAddr !== publicKey) continue;

        // Nur XLM (native) werten wir hier für Groupfund – denn Einzahlungen sind XLM + Memo
        const isNative = rec.asset_type === 'native' || type === 'create_account';
        if (!isNative) continue;

        // Memo der Transaktion ziehen
        const txHash = rec.transaction_hash;
        let memo = txMemoCache.get(txHash);
        if (memo === undefined) {
          try {
            const tx = await server.transactions().transaction(txHash).call();
            memo = tx.memo ? String(tx.memo).trim() : null;
          } catch {
            memo = null;
          }
          txMemoCache.set(txHash, memo);
        }
        if (!memo) continue; // nur Memos zählen

        const amountXlm = parseFloat(rec.amount || '0');
        // Zieladresse ermitteln (nur für Ausgänge): payment -> rec.to, create_account -> rec.account
        let destAddr = null;
        if (type === 'create_account') destAddr = rec.account || null;
        else destAddr = rec.to || rec.to_muxed || null;

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
      pagesSeen += 1;
      page = typeof page.next === 'function' ? await page.next() : null;
    }

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
      totalGroups: items.length,   // Anzahl unterschiedlicher Memos = Anzahl Investitionen (Projekte)
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
    const server = new StellarSdk.Horizon.Server(horizonUrl);

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
}) {
  try {
    if (!publicKey) throw new Error('investedTokens.error.missingPublicKey');

    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const totals = new Map(); // "CODE:ISSUER" -> number (gekaufte Menge)

    // --- (1) Trades des Accounts auswerten ---
    // Horizon: server.trades().forAccount(publicKey)
    let tradesPage = await server.trades().forAccount(publicKey).order('desc').limit(200).call();
    let tradesPagesSeen = 0;

    while (tradesPage?.records?.length && tradesPagesSeen < limitPages) {
      for (const tr of tradesPage.records) {
        // Felder: base_account, counter_account, base_is_seller (bool), base_amount, counter_amount, base_*, counter_*
        const isBaseParty = tr.base_account === publicKey;
        const isCounterParty = tr.counter_account === publicKey;

        // Bestimme, welches Asset du GEKAUFT hast:
        // - Wenn du base_account bist und base_is_seller === false -> du KAUFST base (erhöht base_amount)
        // - Wenn du counter_account bist und base_is_seller === true -> du KAUFST counter (erhöht counter_amount)
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

        // Wir zählen für "Token investiert" nur Nicht-XLM
        if (!boughtCode || boughtCode === 'XLM' || !boughtIssuer) continue;

        const key = `${boughtCode}:${boughtIssuer}`;
        totals.set(key, (totals.get(key) || 0) + boughtAmount);
      }

      tradesPagesSeen += 1;
      tradesPage = typeof tradesPage.next === 'function' ? await tradesPage.next() : null;
    }

    // --- (2) Eingehende Asset-Payments an dich (z. B. path_payment_receive) ---
    let payPage = await server.payments().forAccount(publicKey).order('desc').limit(200).call();
    let payPagesSeen = 0;

    while (payPage?.records?.length && payPagesSeen < limitPages) {
      for (const rec of payPage.records) {
        const type = rec.type;
        // Eingänge an dich
        const toAddr = rec.to || rec.to_muxed || (type === 'create_account' ? rec.account : null);
        if (toAddr !== publicKey) continue;

        // Nicht-XLM Assets
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
      payPage = typeof payPage.next === 'function' ? await payPage.next() : null;
    }

    // --- Ergebnis ---
    const items = [...totals.entries()].map(([tokenKey, total]) => ({
      type: 'token',
      group: tokenKey,        // "CODE:ISSUER"
      totalAmount: total,     // gesamte gekaufte Menge
    }));

    return {
      mode: 'perToken',
      totalTokens: items.length, // Anzahl verschiedener Token, in die du investiert hast
      items,
    };
  } catch (e) {
    const detail = e?.message || 'unknown';
    throw new Error('fetchInvestedTokens.failed:' + detail);
  }
}
