import { useEffect, useRef, useState } from 'react';
import { horizonUrlFor } from '../../config/networks.js';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { normalizeNativePool, positionFromBalance } from '../../utils/stellar/liquidityPools.js';
import { runLimited } from '../../utils/limitConcurrency.js';

const CONCURRENCY = 4;

/**
 * Gegenwert der Pool-Anteile fuer die Wallet-Startseite: laedt je liquidity_pool_shares-Eintrag
 * den Pool (/liquidity_pools/{id}) und rechnet den Anteil an beiden Reserven aus (gleiche Rechnung
 * wie Liquidity, Meine Positionen). Nur wenn enabled (Assets aufgeklappt), hoechstens 4 Pools
 * gleichzeitig. Beim Neuladen des Kontos im selben Netz bleiben geladene Werte sichtbar, bis der
 * neue Wert da ist (kein Flackern); ein Netzwechsel verwirft alles.
 *
 * @returns {Record<string, { status: 'loading'|'loaded'|'error', pool?: object, position?: object }>}
 */
export default function useWalletPoolValues(account, network, enabled) {
  const [values, setValues] = useState({});
  const netRef = useRef(network);

  useEffect(() => {
    const balances = (Array.isArray(account?.balances) ? account.balances : [])
      .filter((b) => b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id);
    const sameNet = netRef.current === network;
    netRef.current = network;
    if (!enabled || balances.length === 0) {
      setValues({});
      return undefined;
    }
    let cancelled = false;
    const server = getHorizonServer(horizonUrlFor(network));
    setValues((prev) => {
      const next = {};
      balances.forEach((b) => {
        const id = b.liquidity_pool_id;
        next[id] = sameNet && prev[id]?.status === 'loaded' ? prev[id] : { status: 'loading' };
      });
      return next;
    });
    runLimited(balances, async (balance) => {
      const poolId = String(balance.liquidity_pool_id);
      let entry;
      try {
        const record = await server.liquidityPools().liquidityPoolId(poolId).call();
        const pool = normalizeNativePool(record, poolId);
        entry = { status: 'loaded', pool, position: positionFromBalance(balance, pool) };
      } catch {
        entry = { status: 'error' };
      }
      if (!cancelled) setValues((prev) => ({ ...prev, [poolId]: entry }));
    }, { limit: CONCURRENCY, isCancelled: () => cancelled }).catch(() => {});
    return () => { cancelled = true; };
  }, [account, network, enabled]);

  return values;
}
