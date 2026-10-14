// XLM-Kurs von CoinGecko (Abruf jede Minute) inkl. 24h-Veraenderung.
// Wird von der Titelleiste genutzt und ist damit auf allen Seiten verfuegbar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const XLM_PRICE_PAIRS = [
  { key: 'EUR', label: '€/XLM', currency: 'eur', symbol: '€' },
  { key: 'USD', label: '$/XLM', currency: 'usd', symbol: '$' },
  { key: 'CHF', label: 'CHF/XLM', currency: 'chf', symbol: 'CHF ' },
  { key: 'GBP', label: '£/XLM', currency: 'gbp', symbol: '£' },
  { key: 'RUB', label: '₽/XLM', currency: 'rub', symbol: '₽' },
];

const PAIR_STORAGE_KEY = 'SKM_XLM_PRICE_PAIR';
const REFRESH_MS = 60000;

function readStoredPair() {
  try {
    const v = window.localStorage?.getItem(PAIR_STORAGE_KEY);
    if (v && XLM_PRICE_PAIRS.some((p) => p.key === v)) return v;
  } catch { /* noop */ }
  return XLM_PRICE_PAIRS[0].key;
}

export function useXlmPrice() {
  const { i18n } = useTranslation();
  const [selectedPair, setSelectedPairState] = useState(readStoredPair);
  const [priceMap, setPriceMap] = useState({});
  const [changeMap, setChangeMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const loadedRef = useRef(false);

  const setSelectedPair = useCallback((key) => {
    setSelectedPairState(key);
    try { window.localStorage?.setItem(PAIR_STORAGE_KEY, key); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    const fetchPrices = async () => {
      if (!loadedRef.current) {
        setLoading(true);
        setError('');
      }
      try {
        const currencies = XLM_PRICE_PAIRS.map((pair) => pair.currency).join(',');
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=${currencies}&include_24hr_change=true`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('price.fetchFailed');
        const data = await res.json();
        if (!isActive) return;
        const raw = data?.stellar || {};
        const nextPrice = {};
        const nextChange = {};
        XLM_PRICE_PAIRS.forEach((pair) => {
          nextPrice[pair.currency] = raw?.[pair.currency];
          nextChange[pair.currency] = raw?.[`${pair.currency}_24h_change`];
        });
        setPriceMap(nextPrice);
        setChangeMap(nextChange);
        loadedRef.current = true;
        setUpdatedAt(new Date());
      } catch (err) {
        if (err?.name === 'AbortError' || !isActive) return;
        if (!loadedRef.current) setError(String(err?.message || 'price.fetchFailed'));
      } finally {
        if (isActive) setLoading(false);
      }
    };
    fetchPrices();
    const id = setInterval(fetchPrices, REFRESH_MS);
    return () => {
      isActive = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  const pair = useMemo(
    () => XLM_PRICE_PAIRS.find((p) => p.key === selectedPair) || XLM_PRICE_PAIRS[0],
    [selectedPair]
  );

  // In der Schweiz Zahlen im Schweizer Format anzeigen (wie bisher in Main).
  const locale = useMemo(() => {
    if (typeof navigator !== 'undefined') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const navLang = navigator.language || '';
      if (tz === 'Europe/Zurich') {
        if (navLang.includes('-')) return `${navLang.split('-')[0]}-CH`;
        return navLang ? `${navLang}-CH` : 'de-CH';
      }
      if (navLang) return navLang;
    }
    return i18n?.language || 'de-DE';
  }, [i18n?.language]);

  const value = priceMap?.[pair.currency];
  const change = changeMap?.[pair.currency];

  const priceDisplay = useMemo(() => {
    if (value == null || Number.isNaN(Number(value))) return 'n/a';
    const f = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    return `${pair.symbol}${f.format(Number(value))}`;
  }, [locale, pair, value]);

  const changeDisplay = useMemo(() => {
    if (change == null || Number.isNaN(Number(change))) return null;
    const f = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${Number(change) > 0 ? '+' : ''}${f.format(Number(change))}%`;
  }, [change, locale]);

  const trend = useMemo(() => {
    if (change == null || Number.isNaN(Number(change))) return null;
    if (Number(change) > 0.05) return 'up';
    if (Number(change) < -0.05) return 'down';
    return 'flat';
  }, [change]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return '';
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(updatedAt);
  }, [locale, updatedAt]);

  const numericValue = value == null || Number.isNaN(Number(value)) ? null : Number(value);

  return {
    pairs: XLM_PRICE_PAIRS,
    selectedPair: pair.key,
    symbol: pair.symbol,
    value: numericValue,
    locale,
    setSelectedPair,
    loading,
    error,
    priceDisplay,
    changeDisplay,
    trend,
    updatedLabel,
  };
}
