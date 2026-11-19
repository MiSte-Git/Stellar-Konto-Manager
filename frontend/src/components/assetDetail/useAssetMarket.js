import { useCallback, useEffect, useRef, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { getHorizonServerForNetwork } from '../../utils/stellar/stellarUtils.js';
import { DAY_MS, LONG_RANGES, loadAssetMarket, loadPriceSeries } from '../../utils/stellar/assetMarket.js';

const EMPTY = { loading: false, data: null, error: false };
const EMPTY_SERIES = { key: '', loading: false, data: null, error: false };

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
  // Tageswerte (30 Tage bis 1 Jahr) je Zeitraum, nur der zuletzt gewaehlte
  const [seriesLong, setSeriesLong] = useState(EMPTY_SERIES);
  const requestRef = useRef(0);
  const assetKeyRef = useRef('');

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    const key = `${network}|${code}|${issuer}`;
    const sameAsset = assetKeyRef.current === key;
    assetKeyRef.current = key;
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

  // 30 Tage bis 1 Jahr brauchen Tageswerte: eigene Abfrage, erst wenn der Zeitraum gewaehlt wird. Endzeit wie die
  // uebrigen Daten (loadedAt), damit Kennzahlen und Verlauf denselben Stand haben (AM-11). Ergebnisse je Zeitraum
  // bleiben im Cache von assetMarket.js (5 Minuten), Hin- und Herwechseln fragt also nicht erneut ab.
  const loadedAt = state.data?.loadedAt;
  // Schluessel aus Netz, Asset, Zeitraum und Stand (Review KV-2): nach Aktualisieren (neues loadedAt) wird die Reihe
  // mit dem neuen Stand geholt, Kennzahlen und Verlauf bleiben gleich alt.
  const isLong = LONG_RANGES.includes(range);
  const longKey = isLong && loadedAt ? `${network}|${code}|${issuer}|${range}|${loadedAt}` : '';
  const longCurrent = !!longKey && seriesLong.key === longKey;
  useEffect(() => {
    if (!longKey || longCurrent) return;
    const assets = enabled ? assetsFor(code, issuer) : null;
    if (!assets) return;
    const wanted = longKey;
    setSeriesLong({ key: wanted, loading: true, data: null, error: false });
    loadPriceSeries({ server: getHorizonServerForNetwork(network), ...assets, range, now: loadedAt })
      .then((data) => setSeriesLong((prev) => (prev.key === wanted ? { key: wanted, loading: false, data, error: false } : prev)))
      .catch(() => setSeriesLong((prev) => (prev.key === wanted ? { key: wanted, loading: false, data: null, error: true } : prev)));
  }, [longKey, longCurrent, range, code, issuer, network, enabled, loadedAt]);

  // Zeitraum waehlen; ein Fehler wird bei der naechsten Auswahl erneut versucht, auch fuer denselben Zeitraum
  // (Review KV-6).
  const selectRange = useCallback((next) => {
    setSeriesLong((prev) => (prev.error ? EMPTY_SERIES : prev));
    setRange(next);
  }, []);

  const data = state.data;
  let series = null;
  let seriesLoading = state.loading && !data;
  let seriesError = false;
  if (isLong) {
    series = longCurrent ? seriesLong.data : null;
    // Vor dem ersten Laden (noch kein Ergebnis, kein Fehler) als laedt zeigen, nicht als zu wenig Handel (AM-10).
    seriesLoading = !!loadedAt && (!longCurrent || seriesLong.loading);
    seriesError = longCurrent && seriesLong.error;
  } else if (data?.series7d) {
    const since = range === '24h' ? data.loadedAt - DAY_MS : data.loadedAt - 7 * DAY_MS;
    series = data.series7d.filter((p) => p.t >= since);
  } else if (data) {
    seriesError = !!data.statsError;
  }

  return { ...state, reload: load, range, setRange: selectRange, series, seriesLoading, seriesError, daily: isLong };
}
