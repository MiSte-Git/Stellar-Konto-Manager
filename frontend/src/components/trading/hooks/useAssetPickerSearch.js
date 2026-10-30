import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/apiBase.js';
import { parseAssetSearchQuery } from '../assetSearchUtils.js';

/**
 * Zustand und Suche fuer einen AssetPickerField: Query, Treffer, Auswahl,
 * Fehler. Nutzt denselben Endpunkt (trade/assets/search) und dieselben
 * Fehlertexte wie der Ziel-Token-Picker in AssetSearch.jsx
 * (handleSwapTargetSearch). Jener ist noch nicht auf diesen Hook umgestellt.
 *
 * Bei exakter Eingabe CODE:ISSUER wird der passende Treffer direkt gewaehlt.
 * Beim Netzwechsel und ueber clear wird alles zurueckgesetzt; veraltete
 * Antworten werden verworfen.
 */
export default function useAssetPickerSearch({ network, t }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const clear = useCallback(() => {
    requestRef.current += 1;
    setQuery('');
    setResults([]);
    setSelected(null);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    clear();
  }, [network, clear]);

  const translateInputError = useCallback((code) => {
    if (code === 'queryMissing') return t('trading:assetSearch.invalidInput.queryMissing');
    if (code === 'codeInvalid') return t('trading:assetSearch.invalidInput.codeInvalid');
    if (code === 'issuerInvalid') return t('trading:assetSearch.invalidInput.issuerInvalid');
    return t('trading:assetSearch.invalidInput.queryInvalid');
  }, [t]);

  const search = useCallback(async () => {
    const parsed = parseAssetSearchQuery(query);
    if (parsed.error) {
      setError(translateInputError(parsed.error));
      return;
    }
    const requestId = ++requestRef.current;
    setError('');
    setResults([]);
    setSelected(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (parsed.code) params.set('code', parsed.code);
      if (parsed.issuer) params.set('issuer', parsed.issuer);
      params.set('limit', '15');
      params.set('network', network);
      const response = await fetch(`${apiUrl('trade/assets/search')}?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'assetSearch.failed:generic');
      if (requestRef.current !== requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setResults(items);
      if (parsed.mode === 'exact') {
        const exact = items.find((item) =>
          String(item.assetCode || '').toUpperCase() === String(parsed.code || '').toUpperCase() &&
          item.assetIssuer === parsed.issuer
        );
        if (exact) setSelected(exact);
      }
    } catch (err) {
      if (requestRef.current !== requestId) return;
      const msg = err?.message || '';
      const m = /^assetSearch\.invalidInput:(queryMissing|codeInvalid|issuerInvalid)/.exec(msg);
      setError(m ? translateInputError(m[1]) : t('trading:assetSearch.failed.generic'));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [query, network, t, translateInputError]);

  const select = useCallback((item) => {
    setSelected(item);
    setQuery(`${item.assetCode}:${item.assetIssuer}`);
    setError('');
  }, []);

  return { query, setQuery, results, selected, select, error, loading, search, clear };
}
