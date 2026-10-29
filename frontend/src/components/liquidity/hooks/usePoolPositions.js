import { useCallback, useEffect, useRef, useState } from 'react';
import { horizonUrlFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { normalizeNativePool, positionFromBalance } from '../../../utils/stellar/liquidityPools.js';
import { isHorizonNotFound } from './poolErrors.js';

const IDLE = { loading: false, error: '', positions: [] };

/**
 * Pool-Positionen eines Kontos: liest die liquidity_pool_shares-Balances und
 * laedt je Pool /liquidity_pools/{id}. Jede Position traegt ihren eigenen
 * Pool-Fehler (poolError), damit ein einzelner nicht ladbarer Pool nicht die
 * ganze Liste verhindert.
 *
 * error: '' | 'accountNotFound' | 'loadFailed'
 * positions: [{ poolId, balance, pool, position, poolError: '' | 'notFound' | 'loadFailed' }]
 *
 * Konto- oder Netzwechsel: Zustand (inkl. Fehler) wird sofort zurueckgesetzt,
 * Antworten aelterer Requests werden ueber requestRef verworfen.
 */
export default function usePoolPositions(publicKey, network) {
  const [state, setState] = useState(IDLE);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const isStale = () => requestRef.current !== requestId;
    if (!publicKey) {
      setState(IDLE);
      return;
    }
    setState({ loading: true, error: '', positions: [] });
    const server = getHorizonServer(horizonUrlFor(network));
    let account;
    try {
      account = await server.accounts().accountId(publicKey).call();
    } catch (err) {
      if (isStale()) return;
      setState({ loading: false, error: isHorizonNotFound(err) ? 'accountNotFound' : 'loadFailed', positions: [] });
      return;
    }
    if (isStale()) return;
    const poolBalances = (account?.balances || []).filter((b) => b.asset_type === 'liquidity_pool_shares');
    const positions = await Promise.all(poolBalances.map(async (balance) => {
      const poolId = String(balance.liquidity_pool_id || '');
      try {
        const record = await server.liquidityPools().liquidityPoolId(poolId).call();
        const pool = normalizeNativePool(record);
        return { poolId, balance, pool, position: positionFromBalance(balance, pool), poolError: '' };
      } catch (err) {
        return { poolId, balance, pool: null, position: null, poolError: isHorizonNotFound(err) ? 'notFound' : 'loadFailed' };
      }
    }));
    if (isStale()) return;
    setState({ loading: false, error: '', positions });
  }, [publicKey, network]);

  useEffect(() => {
    load();
    // Beim Unmount bzw. vor dem naechsten Lauf laufende Antworten verwerfen.
    return () => { requestRef.current += 1; };
  }, [load]);

  return { ...state, reload: load };
}
