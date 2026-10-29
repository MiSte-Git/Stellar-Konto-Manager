import React from 'react';
import { useTranslation } from 'react-i18next';
import { shortenKey } from './assetSearchUtils.js';

/**
 * Token-Picker: Suchfeld + Button, Fehlermeldung, gewaehltes Asset und
 * Trefferliste. Aus dem Ziel-Token-Picker von SwapSection herausgeloest, damit
 * ihn auch die Liquidity-Pool-Seite nutzen kann. Rein darstellend; Suche und
 * Auswahl liegen beim Aufrufer.
 *
 * children wird zwischen gewaehltem Asset und Trefferliste gerendert (in
 * SwapSection die Token-Fakten des Ziel-Assets).
 */
export default function AssetPickerField({
  label,
  placeholder,
  searchLabel,
  selectedLabel,
  query,
  onQueryChange,
  onSearch,
  loading,
  error,
  selected,
  onSelect,
  results,
  formatTrustlineCount,
  children,
}) {
  const { t } = useTranslation(['common']);
  return (
    <>
      <label className="block text-xs">
        <span className="mb-1 block font-semibold">{label}</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSearch();
              }
            }}
            className="w-full rounded-sm border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={loading}
            className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? t('common:loading', 'Loading...') : searchLabel}
          </button>
        </div>
      </label>
      {error && (
        <div className="mt-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {selected && (
        <div className="mt-2 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          <div className="font-semibold">{selectedLabel}</div>
          <div className="font-mono">{selected.assetCode}</div>
          <div className="break-all font-mono">{selected.assetIssuer}</div>
        </div>
      )}
      {children}
      {results.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-sm border border-gray-200 dark:border-gray-700">
          {results.map((item, index) => (
            <button
              key={`${item.assetCode}-${item.assetIssuer}-${index}`}
              type="button"
              onClick={() => onSelect(item)}
              className={`grid w-full grid-cols-[90px_1fr_auto] gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs first:border-t-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                selected?.assetCode === item.assetCode && selected?.assetIssuer === item.assetIssuer
                  ? 'bg-blue-50 dark:bg-blue-950'
                  : ''
              }`}
            >
              <span className="font-mono font-semibold">{item.assetCode}</span>
              <span className="truncate font-mono" title={item.assetIssuer || ''}>
                {shortenKey(item.assetIssuer || '')}
              </span>
              <span>{formatTrustlineCount(item)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
