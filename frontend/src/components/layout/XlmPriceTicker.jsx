import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Kompakte XLM-Kursanzeige (CoinGecko) mit Waehrungsauswahl.
 * Die Daten kommen aus useXlmPrice (einmal in AppLayout aufgerufen).
 * @param {{ price: ReturnType<typeof import('../../utils/useXlmPrice.js').useXlmPrice>, className?: string }} props
 */
export default function XlmPriceTicker({ price, className = '' }) {
  const { t } = useTranslation(['common']);
  if (!price) return null;
  const { pairs, selectedPair, setSelectedPair, loading, error, priceDisplay, changeDisplay, trend, updatedLabel } = price;

  const source = t('common:xlmPrice.source', 'Quelle: CoinGecko');
  const tooltip = error
    ? `${t('common:xlmPrice.unavailable', 'Kurs nicht verfügbar')} · ${source}`
    : updatedLabel
      ? `${source} · ${t('common:xlmPrice.updated', { time: updatedLabel, defaultValue: 'aktualisiert {{time}}' })}`
      : source;

  const trendClass =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-500 dark:text-gray-400';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '•';

  return (
    <div
      data-testid="xlm-price-ticker"
      title={tooltip}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white pl-2.5 pr-1 text-sm dark:border-gray-700 dark:bg-gray-900 ${className}`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">XLM</span>
      <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900 dark:text-white" aria-live="polite">
        {loading ? '…' : priceDisplay}
      </span>
      {changeDisplay && (
        <span className={`whitespace-nowrap text-xs tabular-nums ${trendClass}`}>
          {arrow} {changeDisplay}
        </span>
      )}
      <select
        value={selectedPair}
        onChange={(e) => setSelectedPair(e.target.value)}
        aria-label={t('common:xlmPrice.pair', 'Währung für den XLM-Kurs')}
        className="ml-auto h-7 cursor-pointer rounded-md border-0 bg-transparent px-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {pairs.map((pair) => (
          <option key={pair.key} value={pair.key} className="text-gray-900">
            {pair.key}
          </option>
        ))}
      </select>
    </div>
  );
}
