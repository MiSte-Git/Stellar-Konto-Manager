import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAssetLabel, assetFromOfferSide, formatAssetLabelWithIssuer } from './assetSearchUtils.js';
import HelpLabel from './HelpLabel.jsx';

/**
 * Limit-order (manageSellOffer) section: create form + list of the selected
 * asset's own open offers with cancel action. Extracted from AssetSearch.jsx
 * (step 3 of the file-split) without any behavior change - pure presentation,
 * all state/handlers stay in the container and are passed in as props.
 */
export default function LimitOrdersSection({
  limitOfferStatus,
  onRefresh,
  limitOfferDirection,
  onDirectionChange,
  limitOfferAmount,
  onAmountChange,
  limitOfferPrice,
  onPriceChange,
  selectedStellarAsset,
  limitOfferSellingLabel,
  limitOfferBuyingLabel,
  onCreateOffer,
  isSubmittingOffer,
  pendingAmbiguousSubmission,
  selectedRelatedOffers,
  onCancelOffer,
}) {
  const { t } = useTranslation(['trading', 'common']);
  return (
    <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">
          {t('trading:assetSearch.limitOffer.title')}
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={limitOfferStatus.loading}
          className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {limitOfferStatus.loading
            ? t('common:loading', 'Loading...')
            : t('trading:assetSearch.limitOffer.refresh')}
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-700 dark:text-blue-100">
        {t('trading:assetSearch.limitOffer.description')}
      </p>
      <div className="grid gap-3 lg:grid-cols-[180px_1fr_1fr_auto]">
        <label className="text-xs">
          <span className="mb-1 block font-semibold"><HelpLabel label={t('trading:assetSearch.limitOffer.direction.label')} helpKey="trading:assetSearch.help.limitOfferDirection" /></span>
          <select
            value={limitOfferDirection}
            onChange={(event) => onDirectionChange(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="sell-token-for-xlm">{t('trading:assetSearch.limitOffer.direction.sellTokenForXlm', { asset: formatAssetLabel(selectedStellarAsset) })}</option>
            <option value="sell-xlm-for-token">{t('trading:assetSearch.limitOffer.direction.sellXlmForToken', { asset: formatAssetLabel(selectedStellarAsset) })}</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold">
            <HelpLabel label={t('trading:assetSearch.limitOffer.amount', { asset: limitOfferSellingLabel })} helpKey="trading:assetSearch.help.limitOfferAmount" />
          </span>
          <input
            value={limitOfferAmount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            inputMode="decimal"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold">
            <HelpLabel label={t('trading:assetSearch.limitOffer.price', { selling: limitOfferSellingLabel, buying: limitOfferBuyingLabel })} helpKey="trading:assetSearch.help.limitOfferPrice" />
          </span>
          <input
            value={limitOfferPrice}
            onChange={(event) => onPriceChange(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            inputMode="decimal"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onCreateOffer}
            disabled={isSubmittingOffer || !!pendingAmbiguousSubmission}
            className="w-full rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isSubmittingOffer
              ? t('common:main.processing')
              : t('trading:assetSearch.limitOffer.create')}
          </button>
        </div>
      </div>
      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-blue-900">
        <h4 className="mb-2 text-sm font-semibold">{t('trading:assetSearch.limitOffer.openOffers')}</h4>
        {limitOfferStatus.error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {t('trading:assetSearch.limitOffer.loadFailed')}
          </div>
        )}
        {!limitOfferStatus.error && selectedRelatedOffers.length === 0 && (
          <div className="text-xs text-gray-600 dark:text-blue-100">
            {limitOfferStatus.loading
              ? t('common:loading', 'Loading...')
              : t('trading:assetSearch.limitOffer.noOffers')}
          </div>
        )}
        {selectedRelatedOffers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.selling')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.buying')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.amount')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.price')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedRelatedOffers.map((offer) => {
                  const selling = assetFromOfferSide(offer, 'selling');
                  const buying = assetFromOfferSide(offer, 'buying');
                  return (
                    <tr key={offer.id} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="py-2 pr-3 font-mono">{formatAssetLabelWithIssuer(selling)}</td>
                      <td className="py-2 pr-3 font-mono">{formatAssetLabelWithIssuer(buying)}</td>
                      <td className="py-2 pr-3 font-mono">{offer.amount}</td>
                      <td className="py-2 pr-3 font-mono">{offer.price}</td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => onCancelOffer(offer)}
                          disabled={isSubmittingOffer || !!pendingAmbiguousSubmission}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950"
                        >
                          {t('trading:assetSearch.limitOffer.cancel')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
