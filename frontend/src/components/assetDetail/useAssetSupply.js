import { useEffect, useState } from 'react';
import { getHorizonServerForNetwork } from '../../utils/stellar/stellarUtils.js';
import { assetSupplyFromRecord, pickAssetRecord } from '../../utils/stellar/assetSupply.js';

const EMPTY = { status: 'idle', data: null };

/**
 * Holder und Menge aus Horizon /assets. status: idle | loading | ok | none (kein Datensatz, also keine
 * Trustline) | error (Abruf fehlgeschlagen oder Datensatz unlesbar).
 */
export default function useAssetSupply(code, issuer, network) {
  const [state, setState] = useState(EMPTY);
  useEffect(() => {
    if (!code || !issuer) { setState(EMPTY); return undefined; }
    let cancelled = false;
    setState({ status: 'loading', data: null });
    getHorizonServerForNetwork(network)
      .assets().forCode(code).forIssuer(issuer).limit(10).call()
      .then((page) => {
        if (cancelled) return;
        const record = pickAssetRecord(page?.records, code, issuer);
        if (!record) { setState({ status: 'none', data: null }); return; }
        const data = assetSupplyFromRecord(record, code, issuer);
        setState(data ? { status: 'ok', data } : { status: 'error', data: null });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [code, issuer, network]);
  return state;
}
