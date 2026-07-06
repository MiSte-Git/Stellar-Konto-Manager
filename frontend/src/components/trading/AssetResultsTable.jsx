import React from 'react';
import { useTranslation } from 'react-i18next';
import { shortenKey, assetResultKey } from './assetSearchUtils.js';

// Loading/present/absent checkmark badge for the domain/TOML columns. Only
// ever used in this table - kept private (was the container's own
// renderFactMark() before the file-split).
function FactMark({ checked, loading, label }) {
  const { t } = useTranslation(['trading']);
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
        loading
          ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
          : checked
            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100'
            : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100'
      }`}
      title={label}
      aria-label={`${label}: ${checked ? t('trading:assetSearch.facts.yes') : t('trading:assetSearch.facts.no')}`}
    >
      {loading ? '...' : checked ? '✓' : '×'}
    </span>
  );
}

/**
 * Asset search results table: sortable columns, per-row domain/TOML
 * checkmarks, and the details/trustline/swap row actions. Extracted from
 * AssetSearch.jsx (step 3 of the file-split) without any behavior change -
 * pure presentation, all state/handlers stay in the container and are
 * passed in as props.
 */
export default function AssetResultsTable({
  assetResults,
  assetError,
  assetLoading,
  countFormatter,
  sortedAssetResults,
  assetResultFacts,
  toggleAssetSort,
  sortIndicator,
  formatTrustlineCount,
  onSelectAsset,
  canAddTrustlineFor,
  onOpenTrustlineModal,
  trustlineActionLabel,
}) {
  const { t } = useTranslation(['trading', 'common']);
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700">
      {assetResults.length === 0 && !assetError && !assetLoading && (
        <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
          {t('trading:assetSearch.result.empty')}
        </div>
      )}
      {assetResults.length > 0 && (
        <>
          <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
            <div>{t('trading:assetSearch.result.count', { count: countFormatter.format(assetResults.length) })}</div>
            <div className="mt-1">{t('trading:assetSearch.result.qualityHint')}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.code')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.issuer')}</th>
                  <th className="py-2 pr-3" title={t('trading:assetSearch.result.columnHelp.numAccounts')}>
                    <button
                      type="button"
                      onClick={() => toggleAssetSort('trustlines')}
                      className="font-semibold hover:text-blue-700 dark:hover:text-blue-300"
                      aria-label={t('trading:assetSearch.result.sort.numAccounts')}
                    >
                      {t('trading:assetSearch.result.columns.numAccounts', 'Trustlines')}{sortIndicator('trustlines')}
                    </button>
                  </th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.domain')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.toml')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssetResults.map((r, idx) => {
                  const rowFacts = assetResultFacts[assetResultKey(r)] || {};
                  return (
                    <tr key={`${r.assetCode}-${r.assetIssuer}-${idx}`} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="py-2 pl-3 pr-3 font-mono font-semibold">{r.assetCode}</td>
                      <td className="py-2 pr-3 font-mono" title={r.assetIssuer || ''}>
                        {shortenKey(r.assetIssuer || '') || '—'}
                      </td>
                      <td className="py-2 pr-3">{formatTrustlineCount(r)}</td>
                      <td className="py-2 pr-3">
                        <FactMark
                          checked={rowFacts.homeDomain}
                          loading={rowFacts.loading}
                          label={t('trading:assetSearch.result.factLabels.domain')}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <FactMark
                          checked={rowFacts.tomlListed}
                          loading={rowFacts.loading}
                          label={t('trading:assetSearch.result.factLabels.toml')}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectAsset(r)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                          >
                            {t('trading:assetSearch.actions.details', 'Details')}
                          </button>
                          <button
                            type="button"
                            disabled={!canAddTrustlineFor(r)}
                            onClick={() => onOpenTrustlineModal(r)}
                            className={`rounded border px-2 py-1 text-xs ${
                              canAddTrustlineFor(r)
                                ? 'border-green-300 text-green-800 hover:bg-green-50 dark:border-green-700 dark:text-green-200 dark:hover:bg-green-900'
                                : 'border-gray-200 text-gray-400 dark:border-gray-800'
                            }`}
                            title={t('trading:assetSearch.actions.trustlineNext', 'Next step: create trustline from search result')}
                          >
                            {trustlineActionLabel(r)}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectAsset(r)}
                            className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900"
                            title={t('trading:assetSearch.actions.swapNext', 'Select asset and open swap preview')}
                          >
                            {t('trading:assetSearch.actions.swap', 'Swap')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
