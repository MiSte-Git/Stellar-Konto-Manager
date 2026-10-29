import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAssetTrustlineCount, parseHorizonNumber, shortenKey } from './assetSearchUtils.js';

// Home-Domain nur, wenn die Suchdaten sie mitliefern (derzeit liefern die
// Backends sie nicht; dann wird nichts angezeigt).
function homeDomainOf(item) {
  const value = item?.homeDomain ?? item?.home_domain ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

function sameAsset(a, b) {
  return !!a && !!b && a.assetCode === b.assetCode && a.assetIssuer === b.assetIssuer;
}

/**
 * Token-Picker: Suchfeld + Button, Fehlermeldung, gewaehltes Asset und
 * Trefferliste. Aus dem Ziel-Token-Picker von SwapSection herausgeloest, damit
 * ihn auch die Liquidity-Pool-Seite nutzen kann. Rein darstellend; Suche und
 * Auswahl liegen beim Aufrufer.
 *
 * Die Trefferliste zeigt je Treffer Code, Issuer (gekuerzt, voll per title,
 * kopierbar), Home-Domain falls vorhanden und die Zahl der Trustlines. Reihenfolge
 * wie geliefert, ohne Hervorhebung einzelner Treffer (Token-Trust-Prinzip); nur
 * der gewaehlte Treffer ist markiert.
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
  const { t } = useTranslation(['common', 'trading']);
  const [copiedKey, setCopiedKey] = useState('');
  const codes = [...new Set(results.map((item) => item.assetCode))];
  const heading = codes.length === 1
    ? t('trading:assetPicker.resultsWithCode', { count: results.length, code: codes[0] })
    : t('trading:assetPicker.results', { count: results.length });
  const selectedHomeDomain = homeDomainOf(selected);

  const copyIssuer = async (event, item, key) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.assetIssuer || '');
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1500);
    } catch {
      /* Zwischenablage nicht verfuegbar */
    }
  };

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
        <div className="mt-2 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100" data-testid="asset-picker-selected">
          <div className="font-semibold">{selectedLabel}</div>
          <div className="font-mono">{selected.assetCode}</div>
          <div className="break-all font-mono">{selected.assetIssuer}</div>
          {selectedHomeDomain && (
            <div>{t('trading:assetPicker.homeDomain')}: <span className="font-mono">{selectedHomeDomain}</span></div>
          )}
        </div>
      )}
      {children}
      {results.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="asset-picker-results">
          <div className="text-xs font-semibold">{heading}</div>
          <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {t('trading:assetPicker.sameCodeHint')}
          </p>
          {!selected && <p className="text-xs text-gray-600 dark:text-gray-300">{t('trading:assetPicker.clickToSelect')}</p>}
          <div role="listbox" aria-label={heading} className="max-h-72 overflow-y-auto rounded-sm border border-gray-200 dark:border-gray-700">
            {results.map((item, index) => {
              const key = `${item.assetCode}-${item.assetIssuer}-${index}`;
              const isSelected = sameAsset(selected, item);
              const count = parseHorizonNumber(getAssetTrustlineCount(item));
              const domain = homeDomainOf(item);
              return (
                <div
                  key={key}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(item);
                    }
                  }}
                  className={`flex cursor-pointer gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs first:border-t-0 hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-400 dark:border-gray-800 dark:hover:bg-gray-800 ${
                    isSelected ? 'bg-blue-50 dark:bg-blue-950' : ''
                  }`}
                >
                  <span className="w-4 shrink-0 font-semibold text-blue-700 dark:text-blue-300" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-mono font-semibold">
                      {item.assetCode}
                      {isSelected && <span className="sr-only"> ({t('trading:assetPicker.selectedMark')})</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-gray-600 dark:text-gray-300">{t('trading:assetPicker.issuer')}:</span>{' '}
                      <span className="font-mono" title={item.assetIssuer || ''}>{shortenKey(item.assetIssuer || '')}</span>
                      <button
                        type="button"
                        onClick={(event) => { void copyIssuer(event, item, key); }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="rounded-sm border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        {copiedKey === key ? t('trading:assetPicker.copied') : t('trading:assetPicker.copyIssuer')}
                      </button>
                    </div>
                    {domain && (
                      <div>
                        <span className="text-gray-600 dark:text-gray-300">{t('trading:assetPicker.homeDomain')}:</span>{' '}
                        <span className="font-mono">{domain}</span>
                      </div>
                    )}
                    <div title={t('trading:assetPicker.trustlineCountTitle')}>
                      {count == null
                        ? t('trading:assetPicker.trustlineCountUnknown')
                        : t('trading:assetPicker.trustlineCount', { count, formatted: formatTrustlineCount(item) })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
