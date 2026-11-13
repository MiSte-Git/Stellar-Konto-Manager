import { useEffect, useMemo, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { apiUrl } from '../../../utils/apiBase.js';
import { getHorizonServerForNetwork } from '../../../utils/stellar/stellarUtils.js';
import { runLimited } from '../../../utils/limitConcurrency.js';
import { isExpertFlagged } from '../assetFactsUtils.js';

const CONCURRENCY = 4;
// Referenzmenge fuer die Marktpruefung: gibt es einen Pfad von 1 Einheit des Tokens nach XLM
// (Orderbuch oder Pool), hat der Token einen Marktpreis. Eine leere Antwort zaehlt als kein Pfad
// (Horizon unterscheidet das nicht von "kein Markt"; bekannte Grenze, siehe README).
const MARKET_PROBE_AMOUNT = '1';
const CACHE_TTL_MS = 15 * 60 * 1000;

// Ergebnisse auf Modulebene, Schluessel immer mit Netz: ueberlebt den Wechsel Im Konto /
// Auf der Blockchain (Review W8) und kann Netze nicht vermischen (W3). Eine spaete Antwort wird
// unter dem Netz ihrer Anfrage abgelegt, nie unter dem aktuellen.
const cache = new Map(); // `${network}|${kind}|${key}` -> { value, at }

function cacheKey(network, kind, key) {
  return `${network}|${kind}|${key}`;
}

function cached(network, kind, key) {
  const entry = cache.get(cacheKey(network, kind, key));
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(cacheKey(network, kind, key));
    return undefined;
  }
  return entry.value;
}

/** Nur fuer Tests. */
export function resetTokenFlagCache() {
  cache.clear();
}

async function checkScam(issuer, network, signal) {
  try {
    const params = new URLSearchParams({ issuer, network });
    const res = await fetch(`${apiUrl('trade/assets/expert')}?${params.toString()}`, { signal });
    const entry = await res.json().catch(() => null);
    if (!res.ok || !entry || !entry.status || entry.status === 'unavailable') return 'unknown';
    return isExpertFlagged({ expert: { status: entry.status, tags: Array.isArray(entry.tags) ? entry.tags : [] } }) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

async function checkMarket(token, network) {
  try {
    const server = getHorizonServerForNetwork(network);
    const page = await server.strictSendPaths(new Asset(token.code, token.issuer), MARKET_PROBE_AMOUNT, [Asset.native()]).call();
    return Array.isArray(page?.records) && page.records.length > 0 ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

/**
 * Prueft fuer die Kontoliste im Trading lazy, was der Ausblende-Filter braucht:
 * - scam: StellarExpert-Eintrag mit Warn-Tag (#malicious/#unsafe) je Issuer, ueber das Backend
 *   (trade/assets/expert). Einmal je Issuer und Netz.
 * - market: Pfad von 1 Token nach XLM (Horizon strictSendPaths). Einmal je Token und Netz.
 * Laedt nur, was enabled verlangt, hoechstens 4 Anfragen gleichzeitig, Ergebnisse 15 Minuten je
 * Netz gecacht. Ein Fehler ergibt 'unknown' (der Token wird dann nicht ausgeblendet).
 *
 * @returns {{ scam: Record<string, 'loading'|'yes'|'no'|'unknown'>, market: Record<string, 'loading'|'yes'|'no'|'unknown'> }}
 *   scam ist nach Issuer, market nach CODE:ISSUER geschluesselt, nur fuer das uebergebene Netz.
 */
export default function useTokenFlags(tokens, network, { scam: wantScam = false, market: wantMarket = false } = {}) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState({}); // `${network}|${kind}|${key}` -> true

  useEffect(() => {
    if (!wantScam) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const issuers = [...new Set((tokens || []).map((tk) => tk.issuer))].filter((i) => i && cached(network, 'scam', i) === undefined);
    if (!issuers.length) return undefined;
    setLoading((prev) => ({ ...prev, ...Object.fromEntries(issuers.map((i) => [cacheKey(network, 'scam', i), true])) }));
    runLimited(issuers, async (issuer) => {
      const value = await checkScam(issuer, network, controller.signal);
      if (cancelled) return; // abgebrochene Anfrage: nichts merken, beim naechsten Lauf neu
      cache.set(cacheKey(network, 'scam', issuer), { value, at: Date.now() });
      setLoading((prev) => { const next = { ...prev }; delete next[cacheKey(network, 'scam', issuer)]; return next; });
      setVersion((v) => v + 1);
    }, { limit: CONCURRENCY, isCancelled: () => cancelled }).catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
      setLoading((prev) => {
        const next = { ...prev };
        issuers.forEach((i) => delete next[cacheKey(network, 'scam', i)]);
        return next;
      });
    };
  }, [tokens, network, wantScam]);

  useEffect(() => {
    if (!wantMarket) return undefined;
    let cancelled = false;
    const todo = (tokens || []).filter((tk) => cached(network, 'market', `${tk.code}:${tk.issuer}`) === undefined);
    if (!todo.length) return undefined;
    setLoading((prev) => ({ ...prev, ...Object.fromEntries(todo.map((tk) => [cacheKey(network, 'market', `${tk.code}:${tk.issuer}`), true])) }));
    runLimited(todo, async (tk) => {
      const value = await checkMarket(tk, network);
      if (cancelled) return;
      const key = cacheKey(network, 'market', `${tk.code}:${tk.issuer}`);
      cache.set(key, { value, at: Date.now() });
      setLoading((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setVersion((v) => v + 1);
    }, { limit: CONCURRENCY, isCancelled: () => cancelled }).catch(() => {});
    return () => {
      cancelled = true;
      setLoading((prev) => {
        const next = { ...prev };
        todo.forEach((tk) => delete next[cacheKey(network, 'market', `${tk.code}:${tk.issuer}`)]);
        return next;
      });
    };
  }, [tokens, network, wantMarket]);

  return useMemo(() => {
    const scam = {};
    const market = {};
    (tokens || []).forEach((tk) => {
      const s = cached(network, 'scam', tk.issuer);
      if (s !== undefined) scam[tk.issuer] = s;
      else if (loading[cacheKey(network, 'scam', tk.issuer)]) scam[tk.issuer] = 'loading';
      const mk = `${tk.code}:${tk.issuer}`;
      const m = cached(network, 'market', mk);
      if (m !== undefined) market[mk] = m;
      else if (loading[cacheKey(network, 'market', mk)]) market[mk] = 'loading';
    });
    return { scam, market };
    // version: neu berechnen, sobald ein Ergebnis im Modul-Cache liegt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, network, loading, version]);
}
