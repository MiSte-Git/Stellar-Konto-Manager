import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { shortenKey, assetResultKey } from './assetSearchUtils.js';
import { groupAssetCodes } from './assetCodeGroups.js';

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
 * checkmarks and one row action, Details. Trustline and swap are only
 * reachable from the detail view, after the token facts (ADR 0002: the
 * user decides with the facts in front of them, never straight from a list
 * row). Pure presentation, all state/handlers stay in the container.
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
}) {
  const { t } = useTranslation(['trading', 'common']);
  // Asset codes are case-sensitive on Stellar and, on their own, prove
  // nothing about legitimacy - only the issuer address does. Codes are grouped
  // ignoring case (ldex looks like LDEX but is a different asset), so
  // duplicate-code hits and spelling variants can be flagged instead of
  // silently ranked by quality score.
  const codeGroups = useMemo(() => groupAssetCodes(assetResults), [assetResults]);
  const { duplicateCodes, variantCodes } = codeGroups;
  return (
    <div className="rounded-sm border border-gray-200 dark:border-gray-700">
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
          {duplicateCodes.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.result.duplicateCodeWarning', { codes: duplicateCodes.join(', ') })}
            </div>
          )}
          {variantCodes.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="asset-code-variant-warning">
              {t('trading:assetSearch.result.codeVariantWarning', { codes: variantCodes.join(', ') })}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pl-3 pr-3">{t('trading:assetSearch.result.columns.code')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.issuer')}</th>
                  <th className="py-2 pr-3 whitespace-nowrap" title={t('trading:assetSearch.result.columnHelp.numAccounts')}>
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
                  {/* Nur noch ein Button: schmal halten, damit Code und Issuer Platz haben */}
                  <th className="w-px py-2 pr-3 whitespace-nowrap">{t('trading:assetSearch.result.columns.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssetResults.map((r, idx) => {
                  const rowFacts = assetResultFacts[assetResultKey(r)] || {};
                  const isDuplicateCode = codeGroups.isDuplicate(r.assetCode);
                  const isVariant = codeGroups.hasVariants(r.assetCode);
                  return (
                    <tr key={`${r.assetCode}-${r.assetIssuer}-${idx}`} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="py-2 pl-3 pr-3">
                        <span className="font-mono font-semibold">{r.assetCode}</span>
                        {isDuplicateCode && (
                          <span
                            className="ml-1 inline-flex items-center rounded-sm bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                            title={t('trading:assetSearch.result.duplicateCodeBadge', { count: codeGroups.countOf(r.assetCode) })}
                          >
                            {codeGroups.countOf(r.assetCode)}×
                          </span>
                        )}
                        {isVariant && (
                          <span
                            className="ml-1 inline-flex items-center rounded-sm bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                            title={t('trading:assetSearch.result.codeVariantBadge')}
                            data-testid="asset-code-variant-badge"
                          >
                            {t('trading:assetSearch.result.codeVariantBadgeText')}
                          </span>
                        )}
                      </td>
                      {/* Issuer address is deliberately styled at least as prominently as
                          the code: on Stellar the code alone never proves authenticity,
                          only the issuer does - de-emphasizing it here would repeat the
                          exact confusion this table is meant to prevent. */}
                      <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap" title={r.assetIssuer || ''}>
                        {shortenKey(r.assetIssuer || '') || '—'}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatTrustlineCount(r)}</td>
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
                      <td className="w-px py-2 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectAsset(r)}
                          className="rounded-sm border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          {t('trading:assetSearch.actions.details', 'Details')}
                        </button>
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
