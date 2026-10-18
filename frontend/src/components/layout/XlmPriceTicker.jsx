import React from 'react';
import { useTranslation } from 'react-i18next';

const BOX_CLASS =
  'inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-sm dark:border-gray-700 dark:bg-gray-900';
// Schmale Leiste unter der Titelleiste (Handy/Tablet): ohne Rahmen, kleinere Schrift.
const COMPACT_CLASS = 'inline-flex min-w-0 items-center gap-1.5 text-xs';

function trendClassOf(trend) {
  if (trend === 'up') return 'text-emerald-600 dark:text-emerald-400';
  if (trend === 'down') return 'text-red-600 dark:text-red-400';
  return 'text-gray-500 dark:text-gray-400';
}

function arrowOf(trend) {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '•';
}

/** Ein Kurs (Label, Preis, 24h-Veraenderung). */
function Quote({ label, loading, quote, compact }) {
  return (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
      <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900 dark:text-white" aria-live="polite">
        {loading ? '…' : quote.priceDisplay}
      </span>
      {quote.changeDisplay && (
        <span
          className={`whitespace-nowrap text-xs tabular-nums ${trendClassOf(quote.trend)}`}
          title={quote.changeDisplay}
        >
          {arrowOf(quote.trend)}
          <span className={compact ? 'hidden min-[400px]:inline' : ''}> {quote.changeDisplay}</span>
        </span>
      )}
    </>
  );
}

/**
 * Kompakte Kursanzeige (CoinGecko): XLM plus ein zweites Feld mit XRP in
 * derselben Waehrung. Die Waehrung waehlt man ueber PriceCurrencyMenu.
 * Die Daten kommen aus useXlmPrice (einmal in AppLayout aufgerufen).
 * compact: schmale Darstellung fuer die Kursleiste unter der Titelleiste.
 * @param {{ price: ReturnType<typeof import('../../utils/useXlmPrice.js').useXlmPrice>, className?: string, compact?: boolean }} props
 */
export default function XlmPriceTicker({ price, className = '', compact = false }) {
  const { t } = useTranslation(['common']);
  if (!price) return null;
  const { loading, error, priceDisplay, changeDisplay, trend, updatedLabel, xrp } = price;

  const source = t('common:xlmPrice.source', 'Quelle: CoinGecko');
  const tooltip = error
    ? `${t('common:xlmPrice.unavailable', 'Kurs nicht verfügbar')} · ${source}`
    : updatedLabel
      ? `${source} · ${t('common:xlmPrice.updated', { time: updatedLabel, defaultValue: 'aktualisiert {{time}}' })}`
      : source;

  const box = compact ? COMPACT_CLASS : BOX_CLASS;
  return (
    <div
      data-testid="xlm-price-ticker"
      title={tooltip}
      className={`inline-flex items-center ${compact ? 'gap-3' : 'gap-2'} ${className}`}
    >
      <div className={box}>
        <Quote label="XLM" loading={loading} quote={{ priceDisplay, changeDisplay, trend }} compact={compact} />
      </div>
      {xrp && (
        <div data-testid="xrp-price-ticker" className={box}>
          <Quote label="XRP" loading={loading} quote={xrp} compact={compact} />
        </div>
      )}
    </div>
  );
}
