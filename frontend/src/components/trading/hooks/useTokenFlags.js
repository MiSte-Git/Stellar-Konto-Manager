import { useEffect, useRef, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { apiUrl } from '../../../utils/apiBase.js';
import { getHorizonServerForNetwork } from '../../../utils/stellar/stellarUtils.js';
import { isExpertFlagged } from '../assetFactsUtils.js';

const CONCURRENCY = 4;
// Referenzmenge fuer die Marktpruefung: gibt es einen Pfad von 1 Einheit des Tokens nach XLM
// (Orderbuch oder Pool), hat der Token einen Marktpreis.
const MARKET_PROBE_AMOUNT = '1';

async function runLimited(items, worker, isCancelled) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !isCancelled()) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Prueft fuer die Kontoliste im Trading lazy, was der Ausblende-Filter braucht:
 * - scam: StellarExpert-Eintrag mit Warn-Tag (#malicious/#unsafe) je Issuer, ueber das Backend
 *   (trade/assets/expert). Einmal je Issuer.
 * - market: Pfad von 1 Token nach XLM (Horizon strictSendPaths). Einmal je Token.
 * Laedt nur, was enabled verlangt, hoechstens 4 Anfragen gleichzeitig, Ergebnisse je Netz gecacht.
 * Ein Fehler ergibt 'unknown' (der Token wird dann nicht ausgeblendet).
 *
 * @returns {{ scam: Record<string, 'loading'|'yes'|'no'|'unknown'>, market: Record<string, 'loading'|'yes'|'no'|'unknown'> }}
 *   scam ist nach Issuer, market nach CODE:ISSUER geschluesselt.
 */
export default function useTokenFlags(tokens, network, { scam: wantScam = false, market: wantMarket = false } = {}) {
  const [scam, setScam] = useState({});
  const [market, setMarket] = useState({});
  const scamRef = useRef({});
  const marketRef = useRef({});
  const netRef = useRef(network);

  // Netzwechsel verwirft alles Gepruefte
  useEffect(() => {
    if (netRef.current === network) return;
    netRef.current = network;
    scamRef.current = {};
    marketRef.current = {};
    setScam({});
    setMarket({});
  }, [network]);

  useEffect(() => {
    if (!wantScam) return undefined;
    let cancelled = false;
    const issuers = [...new Set((tokens || []).map((tk) => tk.issuer))].filter((i) => i && !scamRef.current[i]);
    if (!issuers.length) return undefined;
    const set = (issuer, value) => {
      scamRef.current = { ...scamRef.current, [issuer]: value };
      if (!cancelled) setScam(scamRef.current);
    };
    issuers.forEach((i) => { scamRef.current = { ...scamRef.current, [i]: 'loading' }; });
    setScam(scamRef.current);
    runLimited(issuers, async (issuer) => {
      try {
        const params = new URLSearchParams({ issuer, network });
        const res = await fetch(`${apiUrl('trade/assets/expert')}?${params.toString()}`);
        const entry = await res.json().catch(() => null);
        if (!res.ok || !entry || !entry.status || entry.status === 'unavailable') { set(issuer, 'unknown'); return; }
        set(issuer, isExpertFlagged({ expert: { status: entry.status, tags: Array.isArray(entry.tags) ? entry.tags : [] } }) ? 'yes' : 'no');
      } catch {
        set(issuer, 'unknown');
      }
    }, () => cancelled).catch(() => {});
    return () => {
      cancelled = true;
      // Abgebrochene (noch 'loading') beim naechsten Lauf neu pruefen
      const next = { ...scamRef.current };
      Object.keys(next).forEach((k) => { if (next[k] === 'loading') delete next[k]; });
      scamRef.current = next;
    };
  }, [tokens, network, wantScam]);

  useEffect(() => {
    if (!wantMarket) return undefined;
    let cancelled = false;
    const todo = (tokens || []).filter((tk) => !marketRef.current[`${tk.code}:${tk.issuer}`]);
    if (!todo.length) return undefined;
    const set = (key, value) => {
      marketRef.current = { ...marketRef.current, [key]: value };
      if (!cancelled) setMarket(marketRef.current);
    };
    todo.forEach((tk) => { marketRef.current = { ...marketRef.current, [`${tk.code}:${tk.issuer}`]: 'loading' }; });
    setMarket(marketRef.current);
    const server = getHorizonServerForNetwork(network);
    runLimited(todo, async (tk) => {
      const key = `${tk.code}:${tk.issuer}`;
      try {
        const page = await server.strictSendPaths(new Asset(tk.code, tk.issuer), MARKET_PROBE_AMOUNT, [Asset.native()]).call();
        set(key, Array.isArray(page?.records) && page.records.length > 0 ? 'yes' : 'no');
      } catch {
        set(key, 'unknown');
      }
    }, () => cancelled).catch(() => {});
    return () => {
      cancelled = true;
      const next = { ...marketRef.current };
      Object.keys(next).forEach((k) => { if (next[k] === 'loading') delete next[k]; });
      marketRef.current = next;
    };
  }, [tokens, network, wantMarket]);

  return { scam, market };
}
