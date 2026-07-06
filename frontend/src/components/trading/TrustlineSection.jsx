import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDetailedAssetPath } from './assetSearchUtils.js';
import HelpLabel from './HelpLabel.jsx';

/**
 * "Trustline missing" section: limit input + reserve preview + "add
 * trustline" button, plus the combined trustline+swap sub-flow (preview a
 * strict-send path and, if it clears, add the trustline and swap in one
 * transaction). Extracted from AssetSearch.jsx (step 3 of the file-split)
 * without any behavior change - pure presentation, all state/handlers stay
 * in the container and are passed in as props.
 *
 * Only rendered by the container while trustlineStatus.state === 'missing'
 * && accountId - that condition itself stays in the container.
 *
 * swapAmount/swapSlippage/swapPreview are the SAME container state the main
 * SwapSection reads/writes (the combined flow reuses the "trustline present"
 * swap form's fields) - this is intentional shared state, not a duplicate.
 */
export default function TrustlineSection({
  trustlineLimit,
  onLimitChange,
  trustlineReserveSummary,
  amountFormatter,
  selectedAssetNeedsAuthorization,
  onAddTrustline,
  isSubmittingTrustline,
  pendingAmbiguousSubmission,
  swapAmount,
  onSwapAmountChange,
  swapSlippage,
  onSwapSlippageChange,
  onPreviewCombined,
  swapPreview,
  canPreviewTrustlineSwap,
  selectedAssetAuthRequired,
  bestDestinationAmount,
  swapDestinationLabel,
  minimumDestinationAmount,
  quoteDetails,
  swapSourceAsset,
  swapDestinationAsset,
  onOpenTrustlineSwapModal,
  isSubmittingSwap,
}) {
  const { t } = useTranslation(['trading', 'common']);
  return (
    <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
      <h3 className="mb-3 text-sm font-semibold">
        {t('trading:assetSearch.trustlineFlow.title')}
      </h3>
      <label className="block text-xs font-semibold" htmlFor="trustline-limit-input">
        <HelpLabel label={t('trading:assetSearch.trustlineConfirm.limit')} helpKey="trading:assetSearch.help.trustlineLimit" />
      </label>
      <input
        id="trustline-limit-input"
        type="text"
        inputMode="decimal"
        value={trustlineLimit}
        onChange={(event) => onLimitChange(event.target.value)}
        className="mt-1 w-full max-w-xs rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
      />
      <p className="mt-2 text-xs text-gray-700 dark:text-blue-100">
        {t('trading:assetSearch.trustlineFlow.limitHelp')}
      </p>
      {trustlineReserveSummary && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.reserveIncrease')} helpKey="trading:assetSearch.help.reserveIncrease" /></dt>
            <dd>{amountFormatter.format(trustlineReserveSummary.extraReserve)} XLM</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.reserveAfter')} helpKey="trading:assetSearch.help.reserveAfter" /></dt>
            <dd>{amountFormatter.format(trustlineReserveSummary.afterTrustlineMinimum)} XLM</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.spendableAfter')} helpKey="trading:assetSearch.help.spendableAfter" /></dt>
            <dd>
              {trustlineReserveSummary.spendableAfterTrustline == null
                ? t('trading:assetSearch.swapPreview.notAvailable')
                : `${amountFormatter.format(trustlineReserveSummary.spendableAfterTrustline)} XLM`}
            </dd>
          </div>
        </dl>
      )}
      {selectedAssetNeedsAuthorization && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.trustlineFlow.authRequiredHint')}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onAddTrustline}
        disabled={isSubmittingTrustline || !!pendingAmbiguousSubmission}
        className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        {isSubmittingTrustline
          ? t('common:main.processing')
          : t('trading:assetSearch.actions.trustlineAdd', 'Add trustline')}
      </button>
      </div>
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className="mb-2 text-sm font-semibold">{t('trading:assetSearch.trustlineFlow.combinedTitle')}</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.sendAmount', { asset: 'XLM' })}</span>
            <input
              type="text"
              inputMode="decimal"
              value={swapAmount}
              onChange={(event) => onSwapAmountChange(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={swapSlippage}
              onChange={(event) => onSwapSlippageChange(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={onPreviewCombined}
              disabled={swapPreview.loading || !canPreviewTrustlineSwap}
              className="rounded border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900"
            >
              {swapPreview.loading ? t('common:loading', 'Loading...') : t('trading:assetSearch.swapPreview.check')}
            </button>
          </div>
        </div>
        {!canPreviewTrustlineSwap && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {selectedAssetAuthRequired
              ? t('trading:assetSearch.trustlineFlow.authRequiredCombinedBlocked')
              : t('trading:assetSearch.trustlineFlow.combinedOnlyXlm')}
          </p>
        )}
        {swapPreview.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {swapPreview.error}
          </div>
        )}
        {swapPreview.path && (
          <div className="mt-3 rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.expected')}</dt>
                <dd className="font-mono">{bestDestinationAmount} {swapDestinationLabel}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.minimum')}</dt>
                <dd className="font-mono">{minimumDestinationAmount || '—'} {swapDestinationLabel}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
                <dd className="break-all font-mono">{quoteDetails?.detailedRoute || formatDetailedAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={onOpenTrustlineSwapModal}
              disabled={isSubmittingSwap || !canPreviewTrustlineSwap || !!pendingAmbiguousSubmission}
              className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmittingSwap
                ? t('common:main.processing')
                : t('trading:assetSearch.trustlineFlow.combinedAction')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
