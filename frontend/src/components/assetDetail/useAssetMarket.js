import { useCallback, useEffect, useRef, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { getHorizonServerForNetwork } from '../../utils/stellar/stellarUtils.js';
import { DAY_MS, loadAssetMarket, loadPriceSeries } from '../../utils/stellar/assetMarket.js';

const EMPTY = { loading: false, data: null, error: false };
const EMPTY_SERIES = { loading: false, data: null, error: false };

function assetsFor(code, issuer) {
  try {
    return { tokenAsset: new Asset(code, issuer), nativeAsset: Asset.native() };
  } catch {
    return null;
  }
}

/**
 * Marktdaten fuer die Asset-Detailseite. Geladen wird beim Oeffnen und nur auf Knopfdruck neu (reload), nicht
 * laufend. Immer mit dem Netz der Seite (getHorizonServerForNetwork). Spaete Antworten nach einem Wechsel von
 * Asset oder Netz werden verworfen; bei einem Wechsel verschwinden die alten Daten sofort (Review AM-1), nur ein
 * Reload desselben Assets laesst sie bis zur neuen Antwort stehen.
 */
export default function useAssetMarket({ code, issuer, network, enabled }) {
  const [state, setState] = useState(EMPTY);
  const [range, setRange] = useState('7d');
  const [series30d, setSeries30d] = useState(EMPTY_SERIES);
  const requestRef = useRef(0);
  const assetKeyRef = useRef('');

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    const key = `${network}|${code}|${issuer}`;
    const sameAsset = assetKeyRef.current === key;
    assetKeyRef.current = key;
    setSeries30d(EMPTY_SERIES);
    const assets = enabled ? assetsFor(code, issuer) : null;
    if (!assets) {
      setState(EMPTY);
      return;
    }
    setState((prev) => (sameAsset ? { ...prev, loading: true, error: false } : { ...EMPTY, loading: true }));
    try {
      const data = await loadAssetMarket({
        server: getHorizonServerForNetwork(network),
        ...assets,
        token: { code, issuer },
      });
      if (id !== requestRef.current) return;
      setState(data.allFailed
        ? { loading: false, data: null, error: true, rateLimited: !!data.rateLimited }
        : { loading: false, data, error: false });
    } catch {
      if (id !== requestRef.current) return;
      setState({ loading: false, data: null, error: true });
    }
  }, [code, issuer, network, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // 30 Tage brauchen Tageswerte: eigene Abfrage, erst wenn der Zeitraum gewaehlt wird. Endzeit wie die uebrigen
  // Daten (loadedAt), damit Kennzahlen und Verlauf denselben Stand haben (AM-11).
  const loadedAt = state.data?.loadedAt;
  useEffect(() => {
    if (range !== '30d' || !loadedAt || series30d.data || series30d.loading || series30d.error) return;
    const assets = enabled ? assetsFor(code, issuer) : null;
    if (!assets) return;
    const id = requestRef.current;
    setSeries30d({ loading: true, data: null, error: false });
    loadPriceSeries({ server: getHorizonServerForNetwork(network), ...assets, range: '30d', now: loadedAt })
      .then((data) => { if (id === requestRef.current) setSeries30d({ loading: false, data, error: false }); })
      .catch(() => { if (id === requestRef.current) setSeries30d({ loading: false, data: null, error: true }); });
  }, [range, series30d, code, issuer, network, enabled, loadedAt]);

  const data = state.data;
  let series = null;
  let seriesLoading = state.loading && !data;
  let seriesError = false;
  if (range === '30d') {
    series = series30d.data;
    // Vor dem ersten Laden (noch kein Ergebnis, kein Fehler) als laedt zeigen, nicht als zu wenig Handel (AM-10).
    seriesLoading = series30d.loading || (!!loadedAt && !series30d.data && !series30d.error);
    seriesError = series30d.error;
  } else if (data?.series7d) {
    const since = range === '24h' ? data.loadedAt - DAY_MS : data.loadedAt - 7 * DAY_MS;
    series = data.series7d.filter((p) => p.t >= since);
  } else if (data) {
    seriesError = !!data.statsError;
  }

  return { ...state, reload: load, range, setRange, series, seriesLoading, seriesError };
}
