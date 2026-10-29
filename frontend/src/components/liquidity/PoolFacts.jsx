import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { poolSidesInOrder } from '../../utils/stellar/liquidityPools.js';
import { formatAssetLabelWithIssuer, getAssetCode, getAssetIssuer } from '../trading/assetSearchUtils.js';
import TokenFactsSummary from '../trading/TokenFactsSummary.jsx';
import useAssetFacts from '../trading/hooks/useAssetFacts.js';
import { formatPoolAmount } from './formatPoolAmount.js';

function Fact({ label, children, wide = false }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="font-semibold">{label}</dt>
      <dd className="break-all font-mono">{children}</dd>
    </div>
  );
}

/**
 * Fakten eines Pools: Quelle, Reserven (in Nutzerreihenfolge), Total Shares,
 * Teilnehmer, Fee, Pool-ID zum Kopieren und die bestehende TokenFactsSummary
 * fuer jedes Nicht-XLM-Asset. Keine Bewertung, nur Daten.
 *
 * useAssetFacts stammt aus Trading und kennt "ausgewaehltes Asset" und
 * "Ziel-Asset eines Token-zu-Token-Tauschs"; hier werden die beiden Slots
 * fuer die zwei Pool-Assets genutzt.
 */
export default function PoolFacts({ pool, firstAsset, network }) {
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
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <Fact label={t('liquidity:source.label')}>{t('liquidity:source.native')}</Fact>
          <Fact label={t('liquidity:facts.fee')}>{t('liquidity:facts.feeValue', { percent: feePercent, bps: pool.feeBps })}</Fact>
          {sides.map((side) => (
            <Fact key={formatAssetLabelWithIssuer(side.asset)} label={t('liquidity:facts.reserve', { asset: formatAssetLabelWithIssuer(side.asset) })}>
              {formatPoolAmount(side.reserve, locale)}
            </Fact>
          ))}
          <Fact label={t('liquidity:facts.totalShares')}>{formatPoolAmount(pool.totalShares, locale)}</Fact>
          <Fact label={t('liquidity:facts.participants')}>{pool.totalTrustlines.toLocaleString(locale)}</Fact>
          <Fact label={t('liquidity:facts.poolId')} wide>
            <span className="mr-2">{pool.poolId}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-sm border border-gray-300 px-2 py-0.5 font-sans text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {copied ? t('liquidity:facts.copied') : t('liquidity:facts.copy')}
            </button>
          </Fact>
        </dl>
        {pool.totalShares === 0n && (
          <p className="mt-3 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            {t('liquidity:facts.emptyPool')}
          </p>
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
