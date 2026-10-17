// XLM-Kurs (und XRP-Vergleichskurs in derselben Waehrung) von CoinGecko
// (Abruf jede Minute) inkl. 24h-Veraenderung.
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

// CoinGecko-IDs: XLM ist der Hauptkurs, XRP wird zum Vergleich mitgeladen.
const COIN_IDS = { xlm: 'stellar', xrp: 'ripple' };

const PAIR_STORAGE_KEY = 'SKM_XLM_PRICE_PAIR';
const REFRESH_MS = 60000;

function readStoredPair() {
  try {
    const v = window.localStorage?.getItem(PAIR_STORAGE_KEY);
    if (v && XLM_PRICE_PAIRS.some((p) => p.key === v)) return v;
  } catch { /* noop */ }
  return XLM_PRICE_PAIRS[0].key;
}

/** Formatiert Kurs, 24h-Veraenderung und Trend fuer eine Waehrung. */
function buildQuote(rawValue, rawChange, pair, locale) {
  const value = rawValue == null || Number.isNaN(Number(rawValue)) ? null : Number(rawValue);
  const change = rawChange == null || Number.isNaN(Number(rawChange)) ? null : Number(rawChange);
  const priceFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  const changeFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let trend = null;
  if (change != null) trend = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';
  return {
    value,
    priceDisplay: value == null ? 'n/a' : `${pair.symbol}${priceFmt.format(value)}`,
    changeDisplay: change == null ? null : `${change > 0 ? '+' : ''}${changeFmt.format(change)}%`,
    trend,
  };
}

export function useXlmPrice() {
  const { i18n } = useTranslation();
  const [selectedPair, setSelectedPairState] = useState(readStoredPair);
  // { xlm: { eur: 0.25, ... }, xrp: { ... } }
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
          `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(COIN_IDS).join(',')}&vs_currencies=${currencies}&include_24hr_change=true`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('price.fetchFailed');
        const data = await res.json();
        if (!isActive) return;
        const nextPrice = {};
        const nextChange = {};
        Object.entries(COIN_IDS).forEach(([coin, id]) => {
          const raw = data?.[id] || {};
          nextPrice[coin] = {};
          nextChange[coin] = {};
          XLM_PRICE_PAIRS.forEach((pair) => {
            nextPrice[coin][pair.currency] = raw?.[pair.currency];
            nextChange[coin][pair.currency] = raw?.[`${pair.currency}_24h_change`];
          });
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

  const xlm = useMemo(
    () => buildQuote(priceMap?.xlm?.[pair.currency], changeMap?.xlm?.[pair.currency], pair, locale),
    [changeMap, locale, pair, priceMap]
  );
  const xrp = useMemo(
    () => buildQuote(priceMap?.xrp?.[pair.currency], changeMap?.xrp?.[pair.currency], pair, locale),
    [changeMap, locale, pair, priceMap]
  );

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return '';
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(updatedAt);
  }, [locale, updatedAt]);

  return {
    pairs: XLM_PRICE_PAIRS,
    selectedPair: pair.key,
    symbol: pair.symbol,
    value: xlm.value,
    locale,
    setSelectedPair,
    loading,
    error,
    priceDisplay: xlm.priceDisplay,
    changeDisplay: xlm.changeDisplay,
    trend: xlm.trend,
    updatedLabel,
    // XRP in derselben Waehrung wie der gewaehlte XLM-Kurs.
    xrp,
  };
}
