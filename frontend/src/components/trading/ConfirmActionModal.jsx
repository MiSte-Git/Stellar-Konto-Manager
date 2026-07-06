import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAssetLabel, formatAssetLabelWithIssuer, formatAssetPath, formatDetailedAssetPath, normalizeAmount } from './assetSearchUtils.js';
import TokenFactsSummary from './TokenFactsSummary.jsx';

/**
 * The four "review before signing" modals (trustline, trustline+swap
 * combined, swap, limit-offer create/cancel). Extracted from AssetSearch.jsx
 * (step 4 of the file-split) without any behavior change - pure
 * presentation, all state/handlers stay in the container and are passed in
 * as props. Selected via `kind` rather than four separate components since
 * they share the same overlay/box/button shell. Unrelated to and unaffected
 * by the pendingAction/beginAction dispatch pipeline in useTradingSubmit
 * (step 6) - `kind` only picks which review layout to render here.
 */
export default function ConfirmActionModal({
  kind, // 'trustline' | 'trustlineSwap' | 'swap' | 'offer'
  onCancel,
  onConfirm,
  // trustline + trustlineSwap
  selectedAsset,
  trustlineLimitAmount,
  trustlineLimit,
  trustlineReserveSummary,
  amountFormatter,
  assetFacts,
  swapRouteStatus,
  // trustlineSwap + swap
  swapAmount,
  swapPreview,
  swapDestinationLabel,
  minimumDestinationAmount,
  quoteDetails,
  swapSourceAsset,
  swapDestinationAsset,
  // swap only
  swapSourceLabel,
  swapSlippage,
  swapDirection,
  targetStellarAsset,
  targetAssetFacts,
  selectedAssetFactsTitleKey,
  ratioFormatter,
  formatQuoteAge,
  formatPercent,
  // offer only
  pendingOfferAction,
}) {
  const { t } = useTranslation(['trading', 'common']);

  let title;
  let body;
  let confirmLabel;
  let confirmClassName = 'rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700';

  if (kind === 'trustline') {
    title = t('trading:assetSearch.trustlineConfirm.title');
    confirmLabel = t('trading:assetSearch.trustlineConfirm.continue');
    body = (
      <>
        <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.result.columns.code')}</dt>
            <dd className="font-mono">{selectedAsset.assetCode}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.trustlineConfirm.limit')}</dt>
            <dd className="font-mono">{trustlineLimitAmount || trustlineLimit} {selectedAsset.assetCode}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold">{t('trading:assetSearch.result.columns.issuer')}</dt>
            <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
          </div>
        </dl>
        {trustlineReserveSummary && (
          <dl className="mt-4 grid gap-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:grid-cols-2">
            <div>
              <dt className="font-semibold">{t('trading:assetSearch.trustlineFlow.reserveIncrease')}</dt>
              <dd>{amountFormatter.format(trustlineReserveSummary.extraReserve)} XLM</dd>
            </div>
            <div>
              <dt className="font-semibold">{t('trading:assetSearch.trustlineFlow.reserveAfter')}</dt>
              <dd>{amountFormatter.format(trustlineReserveSummary.afterTrustlineMinimum)} XLM</dd>
            </div>
          </dl>
        )}
        <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            {t('trading:assetSearch.facts.title')}
          </h3>
          <TokenFactsSummary facts={assetFacts} asset={selectedAsset} includeDisclaimer routeStatus={swapRouteStatus} />
        </section>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.trustlineConfirm.warning')}
        </p>
      </>
    );
  } else if (kind === 'trustlineSwap') {
    title = t('trading:assetSearch.trustlineFlow.combinedConfirmTitle');
    confirmLabel = t('trading:assetSearch.trustlineFlow.combinedContinue');
    confirmClassName = 'rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700';
    body = (
      <>
        <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100">
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.trustlineConfirm.limit')}</dt>
            <dd className="font-mono">{trustlineLimitAmount || trustlineLimit} {selectedAsset.assetCode}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.send')}</dt>
            <dd className="font-mono">{normalizeAmount(swapAmount) || swapAmount} XLM</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.receive')}</dt>
            <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.minimum')}</dt>
            <dd className="font-mono">{minimumDestinationAmount} {swapDestinationLabel}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
            <dd className="break-all font-mono">{quoteDetails?.detailedRoute || formatDetailedAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
          </div>
        </dl>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.trustlineFlow.combinedWarning')}
        </p>
      </>
    );
  } else if (kind === 'swap') {
    title = t('trading:assetSearch.swapConfirm.title');
    confirmLabel = t('trading:assetSearch.swapConfirm.continue');
    body = (
      <>
        <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100">
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.send')}</dt>
            <dd className="font-mono">{normalizeAmount(swapAmount) || swapAmount} {swapSourceLabel}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.receive')}</dt>
            <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.minimum')}</dt>
            <dd className="font-mono">{minimumDestinationAmount} {swapDestinationLabel}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</dt>
            <dd className="font-mono">{String(swapSlippage || '').replace(',', '.')}%</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.source')}</dt>
            <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
          </div>
          {swapDirection === 'token-to-token' && targetStellarAsset && (
            <div className="grid gap-1">
              <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.destination')}</dt>
              <dd className="break-all font-mono">{targetStellarAsset.issuer}</dd>
            </div>
          )}
          <div className="grid gap-1">
            <dt className="font-semibold">{t('trading:assetSearch.swapPreview.route')}</dt>
            <dd className="font-mono">{formatAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
          </div>
          {quoteDetails && (
            <>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.effectiveRate')}</dt>
                <dd className="font-mono">1 {swapSourceLabel} = {ratioFormatter.format(quoteDetails.effectiveRate)} {swapDestinationLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.quoteAge')}</dt>
                <dd className="font-mono">{formatQuoteAge(quoteDetails.ageSeconds)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
                <dd className="break-all font-mono">{quoteDetails.detailedRoute}</dd>
              </div>
              {swapPreview.refreshComparison && (
                <div className="grid gap-1">
                  <dt className="font-semibold">{t('trading:assetSearch.swapPreview.refreshComparison')}</dt>
                  <dd className="font-mono">
                    {swapPreview.refreshComparison.previousDestinationAmount} {'->'} {swapPreview.refreshComparison.latestDestinationAmount} {swapDestinationLabel}
                    {' '}({formatPercent(swapPreview.refreshComparison.deltaPercent)})
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            {t(selectedAssetFactsTitleKey)}
          </h3>
          <TokenFactsSummary facts={assetFacts} asset={selectedAsset} includeDisclaimer routeStatus={swapRouteStatus} />
        </section>
        {swapDirection === 'token-to-token' && targetStellarAsset && (
          <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
              {t('trading:assetSearch.facts.destinationTitle')}
            </h3>
            <TokenFactsSummary facts={targetAssetFacts} asset={targetStellarAsset} includeRoute={false} />
          </section>
        )}
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.swapConfirm.routeRefresh')}
        </p>
      </>
    );
  } else if (kind === 'offer') {
    title = pendingOfferAction.type === 'cancel'
      ? t('trading:assetSearch.limitOffer.cancelTitle')
      : t('trading:assetSearch.limitOffer.confirmTitle');
    confirmLabel = t('trading:assetSearch.limitOffer.continue');
    body = (
      <>
        <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.selling')}</dt>
            <dd className="font-mono">{formatAssetLabelWithIssuer(pendingOfferAction.selling)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.buying')}</dt>
            <dd className="font-mono">{formatAssetLabelWithIssuer(pendingOfferAction.buying)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.amount')}</dt>
            <dd className="font-mono">
              {pendingOfferAction.type === 'cancel'
                ? t('trading:assetSearch.limitOffer.cancelAmount')
                : `${pendingOfferAction.amount} ${formatAssetLabel(pendingOfferAction.selling)}`}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.price')}</dt>
            <dd className="font-mono">{pendingOfferAction.price}</dd>
          </div>
        </dl>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {pendingOfferAction.type === 'cancel'
            ? t('trading:assetSearch.limitOffer.cancelWarning')
            : t('trading:assetSearch.limitOffer.warning')}
        </p>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
      <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        {body}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmClassName}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
