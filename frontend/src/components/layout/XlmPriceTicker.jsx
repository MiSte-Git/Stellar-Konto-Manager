import React from 'react';
import { useTranslation } from 'react-i18next';

const BOX_CLASS =
  'inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white pl-2.5 text-sm dark:border-gray-700 dark:bg-gray-900';

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
function Quote({ label, loading, quote }) {
  return (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
      <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900 dark:text-white" aria-live="polite">
        {loading ? '…' : quote.priceDisplay}
      </span>
      {quote.changeDisplay && (
        <span className={`whitespace-nowrap text-xs tabular-nums ${trendClassOf(quote.trend)}`}>
          {arrowOf(quote.trend)} {quote.changeDisplay}
        </span>
      )}
    </>
  );
}

/**
 * Kompakte Kursanzeige (CoinGecko) mit Waehrungsauswahl: XLM plus ein zweites
 * Feld mit XRP in derselben Waehrung (Auswahl XLM/EUR -> XRP in EUR).
 * Die Daten kommen aus useXlmPrice (einmal in AppLayout aufgerufen).
 * @param {{ price: ReturnType<typeof import('../../utils/useXlmPrice.js').useXlmPrice>, className?: string }} props
 */
export default function XlmPriceTicker({ price, className = '' }) {
  const { t } = useTranslation(['common']);
  if (!price) return null;
  const { pairs, selectedPair, setSelectedPair, loading, error, priceDisplay, changeDisplay, trend, updatedLabel, xrp } = price;

  const source = t('common:xlmPrice.source', 'Quelle: CoinGecko');
  const tooltip = error
    ? `${t('common:xlmPrice.unavailable', 'Kurs nicht verfügbar')} · ${source}`
    : updatedLabel
      ? `${source} · ${t('common:xlmPrice.updated', { time: updatedLabel, defaultValue: 'aktualisiert {{time}}' })}`
      : source;

  return (
    <div data-testid="xlm-price-ticker" title={tooltip} className={`inline-flex items-center gap-2 ${className}`}>
      <div className={`${BOX_CLASS} flex-1 pr-1`}>
        <Quote label="XLM" loading={loading} quote={{ priceDisplay, changeDisplay, trend }} />
        <select
          value={selectedPair}
          onChange={(e) => setSelectedPair(e.target.value)}
          aria-label={t('common:xlmPrice.pair', 'Währung für den XLM-Kurs')}
          className="ml-auto h-7 cursor-pointer rounded-md border-0 bg-transparent px-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:[color-scheme:dark] dark:hover:bg-gray-800"
        >
          {pairs.map((pair) => (
            <option
              key={pair.key}
              value={pair.key}
              className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
            >
              {pair.key}
            </option>
          ))}
        </select>
      </div>
      {xrp && (
        <div data-testid="xrp-price-ticker" className={`${BOX_CLASS} flex-1 pr-2.5`}>
          <Quote label="XRP" loading={loading} quote={xrp} />
        </div>
      )}
    </div>
  );
}
