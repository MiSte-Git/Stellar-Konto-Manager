// XLM-Kurs (und XRP-Vergleichskurs in derselben Waehrung) von CoinGecko
// (Abruf hoechstens jede Minute) inkl. 24h-Veraenderung.
// Wird von der Titelleiste genutzt und ist damit auf allen Seiten verfuegbar.
//
// CoinGecko begrenzt die freie API je IP. Eine 429-Antwort kommt ohne
// Access-Control-Allow-Origin, der Browser meldet dann einen CORS-Fehler
// (Failed to fetch). Deshalb:
// - Ergebnis im localStorage teilen, damit mehrere Tabs nur einmal abrufen,
// - in verborgenen Tabs nicht abrufen (beim Sichtbarwerden nachholen),
// - nach Fehlern Abstand verdoppeln (bis 15 Minuten), auch tabuebergreifend.

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
export const PRICE_CACHE_KEY = 'SKM_XLM_PRICE_CACHE';
export const REFRESH_MS = 60000;
export const MAX_BACKOFF_MS = 15 * 60000;

/**
 * Liest den geteilten Kurs-Cache: { at, data, failCount, retryAt }.
 * Nur oeffentliche Kursdaten, keine Kontodaten.
 */
export function readPriceCache() {
  try {
    const raw = window.localStorage?.getItem(PRICE_CACHE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writePriceCache(next) {
  try { window.localStorage?.setItem(PRICE_CACHE_KEY, JSON.stringify(next)); } catch { /* noop */ }
}

/** Wartezeit nach n Fehlern in Folge: 2, 4, 8 ... Minuten, hoechstens 15. */
export function backoffMs(failCount) {
  const n = Math.max(1, Number(failCount) || 1);
  return Math.min(REFRESH_MS * 2 ** n, MAX_BACKOFF_MS);
}

/**
 * Entscheidet, ob jetzt abgerufen wird. Liefert 'cache', 'wait' oder 'fetch'.
 * @param {{ at?: number, data?: object, retryAt?: number }} cache
 * @param {number} now
 */
export function priceFetchDecision(cache, now) {
  if (cache?.retryAt && now < cache.retryAt) return cache?.data ? 'cache' : 'wait';
  if (cache?.data && cache?.at && now - cache.at < REFRESH_MS - 1000) return 'cache';
  return 'fetch';
}

function isDocumentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

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
    const applyData = (data, at) => {
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
      setError('');
      setUpdatedAt(new Date(at));
    };

    let inFlight = false;
    const fetchPrices = async () => {
      if (inFlight || isDocumentHidden()) return;
      const now = Date.now();
      const cache = readPriceCache();
      const decision = priceFetchDecision(cache, now);
      if (decision === 'cache') {
        if (cache.data) applyData(cache.data, cache.at || now);
        return;
      }
      if (decision === 'wait') {
        if (!loadedRef.current) setError('price.fetchFailed');
        return;
      }
      inFlight = true;
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
        const at = Date.now();
        writePriceCache({ at, data, failCount: 0, retryAt: 0 });
        applyData(data, at);
      } catch (err) {
        if (err?.name === 'AbortError' || !isActive) return;
        // Fehler (meist 429 ohne CORS-Header) fuer alle Tabs vermerken.
        const prev = readPriceCache();
        const failCount = (Number(prev.failCount) || 0) + 1;
        writePriceCache({ ...prev, failCount, retryAt: Date.now() + backoffMs(failCount) });
        if (!loadedRef.current) setError(String(err?.message || 'price.fetchFailed'));
      } finally {
        inFlight = false;
        if (isActive) setLoading(false);
      }
    };
    const onVisible = () => { if (!isDocumentHidden()) fetchPrices(); };
    fetchPrices();
    const id = setInterval(fetchPrices, REFRESH_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      isActive = false;
      controller.abort();
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
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
