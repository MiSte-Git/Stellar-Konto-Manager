import React from 'react';
import { useTranslation } from 'react-i18next';
import HelpLabel from './HelpLabel.jsx';

/**
 * Read-only "1 XLM = x TOKEN" / "1 TOKEN = x XLM" reference rate for the
 * token currently shown in the details panel. Rendered next to
 * TokenFactsSummary in AssetSearch.jsx's "Token-Fakten" section, but kept as
 * its own component/hook (useExchangeRate) so it doesn't add to that
 * planned-for-decomposition monolith, and so TokenFactsSummary - which is
 * also reused inside every confirmation modal - stays free of live network
 * fetches it would otherwise re-trigger on every modal render.
 *
 * Both directions can independently show "no data" (empty order book, no
 * path found): per the token trust principle, that is shown as a neutral
 * fact, not an error - a token can be completely legitimate and simply have
 * no on-chain liquidity yet.
 */
export default function TokenExchangeRate({ tokenLabel, exchangeRate, ratioFormatter, formatQuoteAge }) {
  const { t } = useTranslation(['trading', 'common']);
  const { loading, loadedAt, orderbook, execution } = exchangeRate;

  const formatRate = (value) => (value == null ? null : ratioFormatter.format(value));

  return (
    <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
      <h4 className="text-sm font-semibold">{t('trading:assetSearch.exchangeRate.title')}</h4>
      {loading && (
        <div className="mt-2 text-xs text-gray-700 dark:text-blue-100">
          {t('trading:assetSearch.exchangeRate.loading')}
        </div>
      )}
      {!loading && (
        <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold">
              <HelpLabel
                label={t('trading:assetSearch.exchangeRate.quickLabel')}
                helpKey="trading:assetSearch.help.exchangeRateQuick"
              />
            </dt>
            {orderbook.xlmToToken != null ? (
              <dd className="font-mono">
                <div>1 XLM = {formatRate(orderbook.xlmToToken)} {tokenLabel}</div>
                <div>1 {tokenLabel} = {formatRate(orderbook.tokenToXlm)} XLM</div>
              </dd>
            ) : (
              <dd>
                {orderbook.error === 'failed'
                  ? t('trading:assetSearch.exchangeRate.failed')
                  : t('trading:assetSearch.exchangeRate.noLiquidity')}
              </dd>
            )}
          </div>
          <div>
            <dt className="font-semibold">
              <HelpLabel
                label={t('trading:assetSearch.exchangeRate.executionLabel')}
                helpKey="trading:assetSearch.help.exchangeRateExecution"
              />
            </dt>
            {execution.xlmToToken != null || execution.tokenToXlm != null ? (
              <dd className="font-mono">
                <div>
                  1 XLM = {execution.xlmToToken != null ? `${formatRate(execution.xlmToToken)} ${tokenLabel}` : t('trading:assetSearch.exchangeRate.noRoute')}
                </div>
                <div>
                  1 {tokenLabel} = {execution.tokenToXlm != null ? `${formatRate(execution.tokenToXlm)} XLM` : t('trading:assetSearch.exchangeRate.noRoute')}
                </div>
              </dd>
            ) : (
              <dd>{t('trading:assetSearch.exchangeRate.noRoute')}</dd>
            )}
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold">{t('trading:assetSearch.exchangeRate.quoteAge')}</dt>
            <dd className="font-mono">{formatQuoteAge(loadedAt ? Math.max(0, Math.floor((Date.now() - loadedAt) / 1000)) : null)}</dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-xs text-gray-700 dark:text-blue-100">
        {t('trading:assetSearch.exchangeRate.disclaimer')}
      </p>
    </section>
  );
}
