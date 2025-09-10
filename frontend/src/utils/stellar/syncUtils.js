// Sync-Funktionen: Backfill & inkrementelles Update aus Horizon -> IndexedDB
// Alle Netz-Aufrufe weiterhin über Horizon-Server-Objekt (stellarUtils).

import { bulkUpsertPayments, getCursor, setCursor, getOldestCreatedAt } from '../db/indexedDbClient';
import { Horizon } from '@stellar/stellar-sdk'; // für Typen/Doku

/** Initialisiert den ASC-Cursor auf den neuesten Payment-Token, falls keiner existiert. */
export async function initCursorIfMissing({ server, accountId }) {
  const cur = await getCursor(accountId);
  if (cur && typeof cur === 'string' && cur.trim()) return cur;
  const p = await server.payments().forAccount(accountId).order('desc').limit(1).join('transactions').call();
  const latest = p?.records?.[0]?.paging_token || null;
  if (latest) await setCursor(accountId, latest);
  return latest;
}

/**
 * Lädt genau EINE Seite aus Horizon.payments (mit join=transactions).
 * @returns {Promise<{records:any[], next: function|null, lastCursor:string|null}>}
 */
async function fetchPaymentsPage({ server, accountId, order='asc', limit=200, cursor }) {
  try {
    let q = server.payments().forAccount(accountId).order(order).limit(Math.min(200, Math.max(1, limit))).join('transactions');
    if (cursor) q = q.cursor(cursor);
    const page = await q.call();
    const last = page.records?.[page.records.length-1]?.paging_token || cursor || null;
    return { records: page.records || [], next: page.next ?? null, lastCursor: last };
  } catch {
    throw new Error('error.horizon.paymentsFetch');
  }
}

// Vergleicht zwei ISO-Strings (UTC, lexikalisch vergleichbar)
function isoMin(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }

function dispatchSync(accountId, payload) {
  try { window.dispatchEvent(new CustomEvent('stm:cache-sync', { detail: { accountId, ...payload } })); } catch {}
}

/**
 * Backfill bis zu einem gegebenen sinceISO (ältere Zahlungen ignorieren).
 * Holt rückwärts (desc) und stoppt, sobald created_at < sinceISO.
 * Alle Texte via UI übersetzen, hier nur Keys werfen.
 */
export async function backfillPayments({ server, accountId, sinceISO, onProgress, signal }) {
  try {
    // UI: Start-Event (SourceInput zeigt Timer)
    try { window.dispatchEvent(new CustomEvent('stm:cache-sync', { detail: { accountId, phase: 'start', kind: 'backfill', ts: Date.now() } })); } catch {}

    // Start bei neuesten Zahlungen und rückwärts laufen
    let builder = server
      .payments()
      .forAccount(accountId)
      .order('desc')        // rückwärts
      .limit(200)
      .join('transactions');

    let page = await builder.call();
    let pageNo = 0;
    let stop = false;

    while (!stop) {
      if (signal?.aborted) throw new Error('cache.backfillAborted');

      const records = page?.records ?? [];
      if (records.length === 0) break;

      // Nur Datensätze >= sinceISO verarbeiten
      const filtered = records.filter(r => !sinceISO || r.created_at >= sinceISO);
      if (filtered.length > 0) {
        await bulkUpsertPayments(accountId, filtered);
      }

      pageNo += 1;
      const newest = records[0]?.created_at || '';
      onProgress?.({
        phase: 'backfill',
        page: pageNo,
        progress: 0.05 + Math.min(pageNo * 0.08, 0.9),
        newest: records[0]?.created_at || ''
      });
      // UI: Progress-Event (für laufende Anzeige unter PublicKey)
      try { window.dispatchEvent(new CustomEvent('stm:cache-sync', { detail: { accountId, phase: 'progress', kind: 'backfill', page: pageNo, ts: Date.now() } })); } catch {}

      // Abbruchbedingung: Wenn die älteste Seite bereits < sinceISO ist
      const oldestInPage = records[records.length - 1]?.created_at;
      if (sinceISO && oldestInPage && oldestInPage < sinceISO) {
        stop = true;
        break;
      }

      // Nächste Seite vorbereiten (cursor = ältester Token der aktuellen Seite)
      const nextCursor = records[records.length - 1].paging_token;
      builder = server
        .payments()
        .forAccount(accountId)
        .order('desc')
        .limit(200)
        .join('transactions')
        .cursor(nextCursor);

      page = await builder.call();
    }
    // UI: Done-Event
    try { window.dispatchEvent(new CustomEvent('stm:cache-sync', { detail: { accountId, phase: 'done', kind: 'backfill', ts: Date.now() } })); } catch {}

  } catch (e) {
    // konsistente verschachtelte Keys
    const detail = e?.message?.split?.(':')?.[1] || 'unknown';
    throw new Error('error.sync.backfillFailed.' + detail);
  }
}


/**
 * Aktualisiert den lokalen Cache inkrementell ab dem zuletzt gespeicherten Cursor.
 * Nutzt *immer* Horizon (Horizon-Verbindung bleibt gewährleistet).
 * Fehler werden als i18n-Keys geworfen (UI übersetzt mit t()).
 */
export async function refreshSinceCursor({ server, accountId, onProgress, signal }) {
  try {
    // 1) Cursor absichern – falls leer, auf "jetzt" setzen und fertig
    const cur = await getCursor(accountId);
    if (!cur) {
      await initCursorIfMissing({ server, accountId });
      onProgress?.({ phase: 'refresh', progress: 1 });
      return;
    }

    // 2) Ab hier normal ASC ab aktuellem Cursor
    let builder = server.payments().forAccount(accountId).order('asc').limit(200).join('transactions').cursor(cur);
    let lastToken = null;
    let pageNo = 0;

    while (true) {
      if (signal?.aborted) throw new Error('cache.sync.aborted');

      // kleine visuelle Bewegung schon VOR dem Netzcall
      onProgress?.({ phase: 'refresh', page: pageNo + 1, progress: 0.05 + Math.min(pageNo * 0.05, 0.4) });

      const page = await builder.call();
      const records = page?.records ?? [];
      if (records.length === 0) break;

      await bulkUpsertPayments(accountId, records);

      lastToken = records[records.length - 1].paging_token;
      pageNo += 1;

      onProgress?.({
        phase: 'refresh',
        page: pageNo,
        progress: 0.1 + Math.min(pageNo * 0.08, 0.9),
        oldest: records[0]?.created_at || ''
      });

      builder = server.payments().forAccount(accountId).order('asc').limit(200).join('transactions').cursor(lastToken);
    }

    if (lastToken) await setCursor(accountId, lastToken);
    onProgress?.({ phase: 'refresh', progress: 1 });
  } catch (e) {
    throw new Error('error.sync.refreshFailed:' + (e?.message || 'unknown'));
  }
}

/**
 * Stellt sicher, dass der lokale Cache mindestens bis `targetSinceISO` reicht.
 * targetSinceISO = min( requiredFromISO, now - prefetchDays ).
 * UI-Texte werden extern via t() angezeigt; hier nur Fehlerkeys werfen.
 */
export async function ensureCoverage({ server, accountId, prefetchDays, requiredFromISO, onProgress, signal }) {
  try {
    const prefetchSinceISO = new Date(Date.now() - prefetchDays * 24 * 3600 * 1000).toISOString();
    const targetSinceISO = isoMin(requiredFromISO, prefetchSinceISO);
    const oldest = await getOldestCreatedAt(accountId);

    window.dispatchEvent(new CustomEvent('stm:cache-sync', {
      detail: { accountId, phase: 'ensure-start', targetSinceISO, oldest, ts: Date.now() }
    }));

    if (!oldest || oldest > targetSinceISO) {
      // Nur so weit zurückfüllen, wie benötigt
      await backfillPayments({ server, accountId, sinceISO: targetSinceISO, onProgress, signal });
      window.dispatchEvent(new CustomEvent('stm:cache-sync', {
        detail: { accountId, phase: 'ensure-done', extended: true, ts: Date.now() }
      }));
    } else {
      window.dispatchEvent(new CustomEvent('stm:cache-sync', {
        detail: { accountId, phase: 'ensure-done', extended: false, ts: Date.now() }
      }));
    }
  } catch (e) {
    throw new Error('cache.coverage.failed:' + (e?.message || 'unknown'));
  }
}
