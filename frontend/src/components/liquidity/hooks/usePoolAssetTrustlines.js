import { useEffect, useMemo, useState } from 'react';
import { horizonUrlFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { getAssetCode, getAssetIssuer, getAssetTrustlineCountNumber } from '../../trading/assetSearchUtils.js';

/**
 * Anzahl Konten mit Trustline je Nicht-XLM-Asset eines Pools, direkt aus
 * Horizon /assets (accounts: authorized + maintain_liabilities + unauthorized).
 * Der Pool kann auch per ID oder aus der Positionsliste kommen, daher wird der
 * Wert hier geladen und nicht aus der Asset-Suche uebernommen.
 *
 * Rueckgabe: { [code:issuer]: { status: 'loading' | 'loaded' | 'unavailable', count } }
 */
export default function usePoolAssetTrustlines(assets, network) {
  const keys = useMemo(
    () => assets
      .filter((asset) => !asset.isNative())
      .map((asset) => ({ code: getAssetCode(asset), issuer: getAssetIssuer(asset) })),
    [assets],
  );
  const signature = keys.map((k) => `${k.code}:${k.issuer}`).join('|');
  const [state, setState] = useState({});

  useEffect(() => {
    let cancelled = false;
    const initial = {};
    keys.forEach((k) => { initial[`${k.code}:${k.issuer}`] = { status: 'loading', count: null }; });
    setState(initial);
    if (!keys.length) return () => { cancelled = true; };

    const server = getHorizonServer(horizonUrlFor(network));
    keys.forEach(async ({ code, issuer }) => {
      const key = `${code}:${issuer}`;
      let next = { status: 'unavailable', count: null };
      try {
        const page = await server.assets().forCode(code).forIssuer(issuer).call();
        const record = Array.isArray(page?.records)
          ? page.records.find((r) => r.asset_code === code && r.asset_issuer === issuer)
          : null;
        if (record) next = { status: 'loaded', count: getAssetTrustlineCountNumber(record) };
      } catch { /* bleibt unavailable */ }
      if (!cancelled) setState((prev) => ({ ...prev, [key]: next }));
    });
    return () => { cancelled = true; };
    // signature bildet keys stabil ab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, network]);

  return state;
}
