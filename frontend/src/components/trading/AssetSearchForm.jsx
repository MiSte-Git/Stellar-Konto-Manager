import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Asset search form: active-account/network info, the search input itself,
 * and the two status banners (ambiguous-submission warning, action message)
 * shown above the results table. Extracted from AssetSearch.jsx (step 3 of
 * the file-split) without any behavior change - pure presentation, all
 * state/handlers stay in the container and are passed in as props.
 *
 * describeSearchMode is passed through as a function prop rather than
 * reimplemented here since it closes over the container's `t` the same way
 * this component's own t() would - no real duplication risk, but kept as a
 * prop for parity with the other extracted sections' pattern.
 */
export default function AssetSearchForm({
  accountInput,
  network,
  assetQuery,
  onQueryChange,
  onSubmit,
  assetLoading,
  parsedQuery,
  describeSearchMode,
  assetError,
  pendingAmbiguousSubmission,
  onAcknowledgeAmbiguous,
  actionMessage,
  modalError,
}) {
  const { t } = useTranslation(['trading', 'common']);
  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t('trading:assetSearch.description', 'Suche nach Asset-Code, Issuer-Adresse oder CODE:ISSUER.')}
      </p>
      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
        <div>
          <span className="font-semibold">{t('trading:assetSearch.account.active', 'Active account')}:</span>{' '}
          {accountInput ? <span className="font-mono break-all">{accountInput}</span> : <span>{t('trading:assetSearch.account.none', 'No account loaded')}</span>}
        </div>
        <div>
          <span className="font-semibold">{t('trading:assetSearch.account.network', 'Network')}:</span>{' '}
          <span>{network}</span>
        </div>
      </div>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold" htmlFor="asset-query-input">
          {t('trading:assetSearch.form.query.label')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="asset-query-input"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            value={assetQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('trading:assetSearch.form.query.placeholder', 'USDC, G... oder USDC:G...')}
          />
          <button
            type="submit"
            disabled={assetLoading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {assetLoading ? t('common:loading', 'Loading…') : t('trading:assetSearch.form.submit')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span>{t('trading:assetSearch.examples.label', 'Examples')}:</span>
          <code>USDC</code>
          <code>G...</code>
          <code>USDC:G...</code>
          {!parsedQuery.error && parsedQuery.mode && (
            <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
              {describeSearchMode(parsedQuery.mode)}
            </span>
          )}
        </div>
        {assetError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {assetError}
          </div>
        )}
      </form>

      {pendingAmbiguousSubmission && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <div className="font-semibold">{t('trading:assetSearch.ambiguousResult.title', 'Status unklar – nicht erneut senden')}</div>
          <div className="mt-1 text-xs">
            {t('trading:assetSearch.ambiguousResult.body', 'Die letzte Transaktion konnte serverseitig nicht eindeutig bestätigt werden (Zeitüberschreitung oder Serverfehler). Bitte prüfen Sie den Transaktions-Hash im Explorer, bevor Sie es erneut versuchen.')}
          </div>
          {pendingAmbiguousSubmission.hash && (
            <div className="mt-1 break-all font-mono text-xs">{pendingAmbiguousSubmission.hash}</div>
          )}
          <button
            type="button"
            className="mt-2 rounded border border-amber-400 px-2 py-1 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900"
            onClick={onAcknowledgeAmbiguous}
          >
            {t('trading:assetSearch.ambiguousResult.acknowledge', 'Status geprüft – Aktionen wieder freigeben')}
          </button>
        </div>
      )}

      {actionMessage && (
        <div className={`rounded border px-3 py-2 text-sm ${
          modalError
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
            : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
        }`}>
          {actionMessage}
        </div>
      )}
    </>
  );
}
