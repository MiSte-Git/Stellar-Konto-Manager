import { useEffect, useState } from 'react';
import { horizonUrlFor } from '../../config/networks.js';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { normalizeNativePool, positionFromBalance } from '../../utils/stellar/liquidityPools.js';

/**
 * Gegenwert der Pool-Anteile fuer die Wallet-Startseite: laedt je liquidity_pool_shares-Eintrag
 * den Pool (/liquidity_pools/{id}) und rechnet den Anteil an beiden Reserven aus (gleiche Rechnung
 * wie Liquidity, Meine Positionen). Nur wenn enabled (Assets aufgeklappt), damit die Startseite
 * bei vielen Pools nicht unnoetig laedt.
 *
 * @returns {Record<string, { status: 'loading'|'loaded'|'error', pool?: object, position?: object }>}
 */
export default function useWalletPoolValues(account, network, enabled) {
  const [values, setValues] = useState({});

  useEffect(() => {
    const balances = (Array.isArray(account?.balances) ? account.balances : [])
      .filter((b) => b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id);
    if (!enabled || balances.length === 0) {
      setValues({});
      return undefined;
    }
    let cancelled = false;
    const server = getHorizonServer(horizonUrlFor(network));
    setValues(Object.fromEntries(balances.map((b) => [b.liquidity_pool_id, { status: 'loading' }])));
    balances.forEach(async (balance) => {
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
    });
    return () => { cancelled = true; };
  }, [account, network, enabled]);

  return values;
}
