import React from 'react';
import { useTranslation } from 'react-i18next';
import { shortenKey, formatAssetPath, formatReserveAsset } from './assetSearchUtils.js';
import { factValue } from './assetFactsUtils.js';
import HelpLabel from './HelpLabel.jsx';
import TokenFactsSummary from './TokenFactsSummary.jsx';

/**
 * Market-swap section: direction picker, token-to-token target search +
 * facts, swap preview (path/slippage/quote details), execute button, and the
 * orderbook/liquidity-pool market-data panel. Extracted from AssetSearch.jsx
 * (step 3 of the file-split) without any behavior change - pure presentation,
 * all state/handlers stay in the container and are passed in as props.
 *
 * formatTrustlineCount/formatQuoteAge/formatPercent are passed through as
 * function props rather than reimplemented here, since they close over the
 * container's Intl formatters (countFormatter/ratioFormatter/amountFormatter)
 * - duplicating them would risk the two copies drifting apart.
 */
export default function SwapSection({
  swapDirection,
  onDirectionChange,
  swapTargetQuery,
  onTargetQueryChange,
  onSearchTarget,
  swapTargetLoading,
  swapTargetError,
  selectedSwapTargetAsset,
  onSelectTarget,
  targetStellarAsset,
  targetAssetFacts,
  swapRouteStatus,
  swapTargetResults,
  formatTrustlineCount,
  swapSourceLabel,
  swapDestinationLabel,
  swapAmount,
  onAmountChange,
  swapSlippage,
  onSlippageChange,
  onPreview,
  swapPreview,
  selectedTrustlineUnauthorized,
  minimumDestinationAmount,
  quoteDetails,
  ratioFormatter,
  amountFormatter,
  countFormatter,
  formatQuoteAge,
  formatPercent,
  onOpenSwapModal,
  isSubmittingSwap,
  pendingAmbiguousSubmission,
  onLoadMarketData,
  marketData,
  marketQuality,
  swapSourceAsset,
  swapDestinationAsset,
}) {
  const { t } = useTranslation(['trading', 'common']);
  return (
    <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
      <h3 className="mb-3 text-sm font-semibold">
        {t('trading:assetSearch.swapPreview.title')}
      </h3>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          ['xlm-to-token', t('trading:assetSearch.swapPreview.direction.xlmToToken')],
          ['token-to-xlm', t('trading:assetSearch.swapPreview.direction.tokenToXlm')],
          ['token-to-token', t('trading:assetSearch.swapPreview.direction.tokenToToken')],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onDirectionChange(value)}
            className={`rounded border px-3 py-2 text-xs font-semibold ${
              swapDirection === value
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {swapDirection === 'token-to-token' && (
        <div className="mb-3 rounded border border-gray-200 p-3 dark:border-gray-700">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.targetAsset')}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={swapTargetQuery}
                onChange={(event) => onTargetQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearchTarget();
                  }
                }}
                className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                placeholder={t('trading:assetSearch.swapPreview.targetPlaceholder')}
              />
              <button
                type="button"
                onClick={onSearchTarget}
                disabled={swapTargetLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {swapTargetLoading
                  ? t('common:loading', 'Loading...')
                  : t('trading:assetSearch.swapPreview.targetSearch')}
              </button>
            </div>
          </label>
          {swapTargetError && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {swapTargetError}
            </div>
          )}
          {selectedSwapTargetAsset && (
            <div className="mt-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
              <div className="font-semibold">{t('trading:assetSearch.swapPreview.targetSelected')}</div>
              <div className="font-mono">{selectedSwapTargetAsset.assetCode}</div>
              <div className="break-all font-mono">{selectedSwapTargetAsset.assetIssuer}</div>
            </div>
          )}
          {targetStellarAsset && (
            <div className="mt-3 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <h4 className="mb-2 text-xs font-semibold">
                {t('trading:assetSearch.facts.destinationTitle')}
              </h4>
              <TokenFactsSummary facts={targetAssetFacts} asset={targetStellarAsset} includeRoute={false} routeStatus={swapRouteStatus} />
            </div>
          )}
          {swapTargetResults.length > 0 && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
              {swapTargetResults.map((item, index) => (
                <button
                  key={`${item.assetCode}-${item.assetIssuer}-${index}`}
                  type="button"
                  onClick={() => onSelectTarget(item)}
                  className={`grid w-full grid-cols-[90px_1fr_auto] gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs first:border-t-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                    selectedSwapTargetAsset?.assetCode === item.assetCode && selectedSwapTargetAsset?.assetIssuer === item.assetIssuer
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
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
        <label className="text-xs">
          <span className="mb-1 block font-semibold">
            {t('trading:assetSearch.swapPreview.sendAmount', { asset: swapSourceLabel })}
          </span>
          <input
            value={swapAmount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            inputMode="decimal"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</span>
          <input
            value={swapSlippage}
            onChange={(event) => onSlippageChange(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            inputMode="decimal"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onPreview}
            disabled={swapPreview.loading || selectedTrustlineUnauthorized}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {swapPreview.loading
              ? t('common:loading', 'Loading...')
              : t('trading:assetSearch.swapPreview.check')}
          </button>
        </div>
      </div>
      <div className="mt-3 text-xs text-gray-700 dark:text-blue-100">
        {swapPreview.error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {swapPreview.error}
          </div>
        )}
        {swapPreview.path && (
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.expected')} helpKey="trading:assetSearch.help.expected" /></dt>
              <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.minimum')} helpKey="trading:assetSearch.help.minimum" /></dt>
              <dd className="font-mono">{minimumDestinationAmount || '—'} {swapDestinationLabel}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.route')} helpKey="trading:assetSearch.help.route" /></dt>
              <dd className="font-mono">{formatAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
            </div>
            {quoteDetails && (
              <>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.effectiveRate')} helpKey="trading:assetSearch.help.effectiveRate" /></dt>
                  <dd className="font-mono">
                    1 {swapSourceLabel} = {ratioFormatter.format(quoteDetails.effectiveRate)} {swapDestinationLabel}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.minimumRate')} helpKey="trading:assetSearch.help.minimumRate" /></dt>
                  <dd className="font-mono">
                    {quoteDetails.minimumRate ? `1 ${swapSourceLabel} = ${ratioFormatter.format(quoteDetails.minimumRate)} ${swapDestinationLabel}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.slippageBuffer')} helpKey="trading:assetSearch.help.slippageBuffer" /></dt>
                  <dd className="font-mono">
                    {quoteDetails.slippageBuffer != null ? `${amountFormatter.format(Math.max(0, quoteDetails.slippageBuffer))} ${swapDestinationLabel}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.hops')} helpKey="trading:assetSearch.help.hops" /></dt>
                  <dd className="font-mono">{quoteDetails.hops}</dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.quoteAge')} helpKey="trading:assetSearch.help.quoteAge" /></dt>
                  <dd className="font-mono">{formatQuoteAge(quoteDetails.ageSeconds)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.routeDetailed')} helpKey="trading:assetSearch.help.routeDetailed" /></dt>
                  <dd className="break-all font-mono">{quoteDetails.detailedRoute}</dd>
                </div>
                {swapPreview.refreshComparison && (
                  <div className="sm:col-span-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
                    <dt className="font-semibold">{t('trading:assetSearch.swapPreview.refreshComparison')}</dt>
                    <dd className="font-mono">
                      {swapPreview.refreshComparison.previousDestinationAmount} {'->'} {swapPreview.refreshComparison.latestDestinationAmount} {swapDestinationLabel}
                      {' '}({formatPercent(swapPreview.refreshComparison.deltaPercent)})
                    </dd>
                  </div>
                )}
              </>
            )}
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={onOpenSwapModal}
                disabled={isSubmittingSwap || !minimumDestinationAmount || selectedTrustlineUnauthorized || !!pendingAmbiguousSubmission}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSubmittingSwap
                  ? t('trading:assetSearch.swapPreview.executing')
                  : t('trading:assetSearch.swapPreview.execute')}
              </button>
            </div>
          </dl>
        )}
      </div>
      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-blue-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold">{t('trading:assetSearch.market.title')}</h4>
          <button
            type="button"
            onClick={onLoadMarketData}
            disabled={marketData.loading}
            className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {marketData.loading
              ? t('common:loading', 'Loading...')
              : t('trading:assetSearch.market.load')}
          </button>
        </div>
        {marketData.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {marketData.error}
          </div>
        )}
        {(marketData.orderbook || marketData.liquidityPools.length > 0) && (
          <div className="mt-3 space-y-3">
          <dl className="grid gap-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-700 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.spread')} helpKey="trading:assetSearch.help.spread" /></dt>
              <dd className="font-mono">{marketQuality.spreadPercent == null ? '—' : formatPercent(marketQuality.spreadPercent)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.priceImpact')} helpKey="trading:assetSearch.help.priceImpact" /></dt>
              <dd className="font-mono">{marketQuality.estimatedImpactPercent == null ? '—' : formatPercent(marketQuality.estimatedImpactPercent)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.topDepth')} helpKey="trading:assetSearch.help.topDepth" /></dt>
              <dd className="font-mono">{amountFormatter.format(marketQuality.topAskDepth)} {swapSourceLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.marketAge')} helpKey="trading:assetSearch.help.marketAge" /></dt>
              <dd className="font-mono">{formatQuoteAge(marketQuality.ageSeconds)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.bestBid')} helpKey="trading:assetSearch.help.bestBid" /></dt>
              <dd className="font-mono">{marketQuality.bestBid == null ? '—' : ratioFormatter.format(marketQuality.bestBid)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.bestAsk')} helpKey="trading:assetSearch.help.bestAsk" /></dt>
              <dd className="font-mono">{marketQuality.bestAsk == null ? '—' : ratioFormatter.format(marketQuality.bestAsk)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.depthCoversAmount')} helpKey="trading:assetSearch.help.depthCoversAmount" /></dt>
              <dd>{marketQuality.topAskCoversSource == null ? '—' : factValue(marketQuality.topAskCoversSource, t)}</dd>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.poolCount')} helpKey="trading:assetSearch.help.poolCount" /></dt>
              <dd className="font-mono">{countFormatter.format(marketQuality.poolCount)}</dd>
            </div>
          </dl>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <h5 className="mb-2 text-xs font-semibold">{t('trading:assetSearch.market.orderbook')}</h5>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['bids', t('trading:assetSearch.market.bids')],
                  ['asks', t('trading:assetSearch.market.asks')],
                ].map(([side, label]) => (
                  <div key={side}>
                    <div className="mb-1 text-xs font-semibold">{label}</div>
                    {(marketData.orderbook?.[side] || []).slice(0, 5).length === 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-300">
                        {t('trading:assetSearch.market.empty')}
                      </div>
                    )}
                    {(marketData.orderbook?.[side] || []).slice(0, 5).map((item, index) => (
                      <div key={`${side}-${index}`} className="grid grid-cols-2 gap-2 border-t border-gray-100 py-1 text-xs dark:border-gray-800">
                        <span className="font-mono">{item.price}</span>
                        <span className="text-right font-mono">{item.amount}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <h5 className="mb-2 text-xs font-semibold">{t('trading:assetSearch.market.amm')}</h5>
              {marketData.liquidityPools.length === 0 && (
                <div className="text-xs text-gray-500 dark:text-gray-300">
                  {t('trading:assetSearch.market.empty')}
                </div>
              )}
              {marketData.liquidityPools.slice(0, 5).map((pool) => (
                <div key={pool.id} className="border-t border-gray-100 py-2 text-xs dark:border-gray-800">
                  <div className="font-mono">{shortenKey(pool.id || '')}</div>
                  {(pool.reserves || []).map((reserve) => (
                    <div key={reserve.asset} className="mt-1 flex justify-between gap-3">
                      <span>{formatReserveAsset(reserve.asset)}</span>
                      <span className="font-mono">{reserve.amount}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          </div>
        )}
      </div>
    </section>
  );
}
