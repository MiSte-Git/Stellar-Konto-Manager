import { useCallback, useEffect, useRef, useState } from 'react';
import { horizonUrlFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { isValidPoolId, normalizeNativePool, poolIdFor } from '../../../utils/stellar/liquidityPools.js';
import { isHorizonNotFound } from './poolErrors.js';

const IDLE = { status: 'idle', pool: null, error: '' };

/**
 * Einzelnen nativen Pool laden, entweder per Asset-Paar
 * (server.liquidityPools().forAssets) oder per Pool-ID.
 *
 * status: 'idle' | 'loading' | 'found' | 'notFound' | 'error'
 * error:  '' | 'emptyPoolId' | 'invalidPoolId' | 'sameAsset' | 'loadFailed'
 *
 * notFound (404 bzw. leere Liste) und error (Netzwerk/Horizon) bleiben
 * getrennt, damit die UI "kein Pool fuer dieses Paar" neutral anzeigen kann.
 * Beim Netzwechsel wird der Zustand zurueckgesetzt und laufende Antworten
 * werden verworfen.
 */
export default function usePoolLookup(network) {
  const [state, setState] = useState(IDLE);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setState(IDLE);
    return () => { requestRef.current += 1; };
  }, [network]);

  // expectedId: angefragte Pool-ID; eine Antwort fuer einen anderen Pool gilt als Ladefehler.
  const run = useCallback(async (fetchRecord, expectedId) => {
    const requestId = ++requestRef.current;
    const isStale = () => requestRef.current !== requestId;
    setState({ status: 'loading', pool: null, error: '' });
    try {
      const record = await fetchRecord(getHorizonServer(horizonUrlFor(network)));
      if (isStale()) return;
      if (!record) {
        setState({ status: 'notFound', pool: null, error: '' });
        return;
      }
      setState({ status: 'found', pool: normalizeNativePool(record, expectedId), error: '' });
    } catch (err) {
      if (isStale()) return;
      if (isHorizonNotFound(err)) setState({ status: 'notFound', pool: null, error: '' });
      else setState({ status: 'error', pool: null, error: 'loadFailed' });
    }
  }, [network]);

  const lookupById = useCallback((poolId) => {
    const id = String(poolId || '').trim().toLowerCase();
    if (!id) {
      requestRef.current += 1;
      setState({ status: 'error', pool: null, error: 'emptyPoolId' });
      return Promise.resolve();
    }
    if (!isValidPoolId(id)) {
      requestRef.current += 1;
      setState({ status: 'error', pool: null, error: 'invalidPoolId' });
      return Promise.resolve();
    }
    return run((server) => server.liquidityPools().liquidityPoolId(id).call(), id);
  }, [run]);

  const lookupByAssets = useCallback((assetA, assetB) => {
    let expectedId;
    try {
      expectedId = poolIdFor(assetA, assetB);
    } catch {
      requestRef.current += 1;
      setState({ status: 'error', pool: null, error: 'sameAsset' });
      return Promise.resolve();
    }
    return run(async (server) => {
      const page = await server.liquidityPools().forAssets(assetA, assetB).call();
      const records = Array.isArray(page?.records) ? page.records : [];
      // forAssets liefert jeden Pool, der beide Assets enthaelt; massgeblich ist
      // der constant-product-Pool mit der aus dem Paar berechneten ID.
      return records.find((r) => r.id === expectedId) || null;
    }, expectedId);
  }, [run]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setState(IDLE);
  }, []);

  return { ...state, lookupById, lookupByAssets, reset };
}
