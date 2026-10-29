import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { poolSidesInOrder } from '../../utils/stellar/liquidityPools.js';
import { formatAssetLabelWithIssuer, getAssetCode, getAssetIssuer } from '../trading/assetSearchUtils.js';
import TokenFactsSummary from '../trading/TokenFactsSummary.jsx';
import useAssetFacts from '../trading/hooks/useAssetFacts.js';
import { formatAmountWithUnit } from './formatPoolAmount.js';
import { FactRow } from './LiquidityDialogShell.jsx';

/**
 * Fakten eines Pools: Quelle, Reserven (in Nutzerreihenfolge), Total Shares,
 * Teilnehmer, Fee, Pool-ID zum Kopieren und die bestehende TokenFactsSummary
 * fuer jedes Nicht-XLM-Asset. Keine Bewertung, nur Daten.
 *
 * useAssetFacts stammt aus Trading und kennt "ausgewaehltes Asset" und
 * "Ziel-Asset eines Token-zu-Token-Tauschs"; hier werden die beiden Slots
 * fuer die zwei Pool-Assets genutzt.
 */
export default function PoolFacts({ pool, firstAsset, network, hasAccount = false, onDeposit }) {
  const { t, i18n } = useTranslation(['liquidity', 'trading', 'common']);
  const locale = i18n.language;
  const [copied, setCopied] = useState(false);
  const sides = useMemo(() => poolSidesInOrder(pool, firstAsset), [pool, firstAsset]);

  const firstFactsAsset = useMemo(() => {
    const issuer = getAssetIssuer(sides[0].asset);
    return issuer ? { assetCode: getAssetCode(sides[0].asset), assetIssuer: issuer } : null;
  }, [sides]);
  const secondAsset = sides[1].asset.isNative() ? null : sides[1].asset;
  const { assetFacts, targetAssetFacts } = useAssetFacts({
    selectedAsset: firstFactsAsset,
    network,
    targetStellarAsset: secondAsset,
    swapDirection: 'token-to-token',
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pool.poolId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  const feePercent = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pool.feeBps / 100);

  return (
    <div className="mt-3 space-y-3" data-testid="pool-facts">
      <div className="rounded-sm border border-gray-200 p-3 dark:border-gray-700">
        <h4 className="mb-2 text-sm font-semibold">
          {t('liquidity:facts.title')}: {sides.map((s) => getAssetCode(s.asset)).join(' / ')}
        </h4>
        <dl className="grid gap-x-6 text-xs sm:grid-cols-2">
          <FactRow label={t('liquidity:source.label')} value={t('liquidity:source.native')} />
          <FactRow label={t('liquidity:facts.fee')} value={t('liquidity:facts.feeValue', { percent: feePercent, bps: pool.feeBps })} />
          {sides.map((side) => (
            <FactRow
              key={formatAssetLabelWithIssuer(side.asset)}
              label={t('liquidity:facts.reserve', { asset: getAssetCode(side.asset) })}
              value={formatAmountWithUnit(side.reserve, formatAssetLabelWithIssuer(side.asset), locale)}
            />
          ))}
          <FactRow label={t('liquidity:facts.totalShares')} value={formatAmountWithUnit(pool.totalShares, t('liquidity:units.shares'), locale)} />
          <FactRow label={t('liquidity:facts.participants')} value={pool.totalTrustlines.toLocaleString(locale)} />
          <FactRow
            className="sm:col-span-2"
            wrap
            label={t('liquidity:facts.poolId')}
            value={(
              <>
                <span className="mr-2">{pool.poolId}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-sm border border-gray-300 px-2 py-0.5 font-sans text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  {copied ? t('liquidity:facts.copied') : t('liquidity:facts.copy')}
                </button>
              </>
            )}
          />
        </dl>
        {pool.totalShares === 0n && (
          <p className="mt-3 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            {t('liquidity:facts.emptyPool')}
          </p>
        )}
        {onDeposit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDeposit(pool, firstAsset)}
              disabled={!hasAccount || pool.totalShares === 0n}
              className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t('liquidity:facts.deposit')}
            </button>
            {!hasAccount && <span className="text-xs text-gray-600 dark:text-gray-300">{t('liquidity:facts.depositNeedsAccount')}</span>}
            {hasAccount && pool.totalShares === 0n && <span className="text-xs text-gray-600 dark:text-gray-300">{t('liquidity:facts.depositEmptyPool')}</span>}
          </div>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sides.map((side, index) => (
          <div key={formatAssetLabelWithIssuer(side.asset)} className="rounded-sm border border-gray-200 p-3 dark:border-gray-700">
            <h5 className="mb-2 text-xs font-semibold">
              {t('liquidity:facts.assetFacts', { asset: formatAssetLabelWithIssuer(side.asset) })}
            </h5>
            {side.asset.isNative() ? (
              <p className="text-xs text-gray-700 dark:text-gray-200">{t('liquidity:facts.nativeAsset')}</p>
            ) : (
              <TokenFactsSummary facts={index === 0 ? assetFacts : targetAssetFacts} asset={side.asset} includeRoute={false} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
