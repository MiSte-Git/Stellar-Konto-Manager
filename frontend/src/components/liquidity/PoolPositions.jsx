import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountGate from '../AccountGate.jsx';
import { formatAssetLabelWithIssuer, getAssetCode } from '../trading/assetSearchUtils.js';
import { shortKey } from '../../utils/multisig/describeOperations.js';
import usePoolPositions from './hooks/usePoolPositions.js';
import { formatAmountWithUnit, formatSharePercent } from './formatPoolAmount.js';
import { FactRow } from './LiquidityDialogShell.jsx';

const NOTICE = 'rounded-sm border px-3 py-2 text-xs';

function PositionRow({ entry, locale, onShowDetails, onWithdraw }) {
  const { t } = useTranslation(['liquidity']);
  const { pool, position, poolError, poolId } = entry;
  if (poolError) {
    return (
      <li className={`${NOTICE} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100`}>
        {poolError === 'notFound'
          ? t('liquidity:positions.poolNotFound', { id: shortKey(poolId) })
          : t('liquidity:positions.poolLoadFailed', { id: shortKey(poolId) })}
      </li>
    );
  }
  const labelA = formatAssetLabelWithIssuer(pool.assetA);
  const labelB = formatAssetLabelWithIssuer(pool.assetB);
  return (
    <li className="rounded-sm border border-gray-200 p-3 text-xs dark:border-gray-700" data-testid="pool-position">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">{labelA} / {labelB}</span>
          <span className="ml-2 rounded-sm bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{t('liquidity:source.native')}</span>
          {position.shares === 0n && (
            <span className="ml-2 rounded-sm border border-gray-300 px-2 py-0.5 dark:border-gray-600">{t('liquidity:positions.zeroShares')}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => onShowDetails(poolId)} className="text-blue-700 underline hover:no-underline dark:text-blue-300">
            {t('liquidity:positions.showDetails')}
          </button>
          {onWithdraw && position.shares > 0n && (
            <button
              type="button"
              onClick={() => onWithdraw(poolId)}
              className="rounded-sm border border-blue-600 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
            >
              {t('liquidity:positions.withdraw')}
            </button>
          )}
        </div>
      </div>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <FactRow label={t('liquidity:positions.shares')} value={formatAmountWithUnit(position.shares, t('liquidity:units.shares'), locale)} />
        <FactRow label={t('liquidity:positions.sharePercent')} value={t('liquidity:positions.sharePercentValue', { percent: formatSharePercent(position.sharePercent, locale) })} />
        <FactRow label={t('liquidity:positions.value', { asset: getAssetCode(pool.assetA) })} value={formatAmountWithUnit(position.amountA, labelA, locale)} />
        <FactRow label={t('liquidity:positions.value', { asset: getAssetCode(pool.assetB) })} value={formatAmountWithUnit(position.amountB, labelB, locale)} />
      </dl>
    </li>
  );
}

/** Listet die Pool-Positionen eines existierenden Kontos (Paar in kanonischer Reihenfolge A/B). */
function PositionsList({ publicKey, network, onShowDetails, onWithdraw }) {
  const { t, i18n } = useTranslation(['liquidity']);
  const { loading, error, positions, reload } = usePoolPositions(publicKey, network);
  if (loading) return <p className="text-xs text-gray-600 dark:text-gray-300">{t('liquidity:positions.loading')}</p>;
  if (error === 'loadFailed') {
    return (
      <div className={`${NOTICE} border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200`}>
        {t('liquidity:positions.loadFailed')}{' '}
        <button type="button" onClick={reload} className="underline hover:no-underline">{t('liquidity:positions.retry')}</button>
      </div>
    );
  }
  if (error === 'accountNotFound') {
    return <AccountGate publicKey={publicKey} notFound netName={network === 'TESTNET' ? 'Testnet' : 'Mainnet'} />;
  }
  if (!positions.length) return <p className="text-xs text-gray-600 dark:text-gray-300">{t('liquidity:positions.empty')}</p>;
  return (
    <ul className="space-y-2">
      {positions.map((entry) => (
        <PositionRow key={entry.poolId} entry={entry} locale={i18n.language} onShowDetails={onShowDetails} onWithdraw={onWithdraw} />
      ))}
    </ul>
  );
}

/**
 * Bereich "Meine Positionen". Ohne geladenes oder im Netz existierendes Konto
 * erscheint die AccountGate (wie bei den anderen kontoabhaengigen Seiten);
 * der Bereich "Pool finden" bleibt davon unberuehrt.
 */
export default function PoolPositions({ publicKey, notFound, accountLoading, network, onShowDetails, onWithdraw, refreshToken = 0 }) {
  const { t } = useTranslation(['liquidity']);
  const netName = network === 'TESTNET' ? 'Testnet' : 'Mainnet';
  let body;
  if (accountLoading) body = <p className="text-xs text-gray-600 dark:text-gray-300">{t('liquidity:positions.loading')}</p>;
  else if (!publicKey || notFound) body = <AccountGate publicKey={publicKey} notFound={!!publicKey && notFound} netName={netName} />;
  else body = <PositionsList key={`${network}:${publicKey}:${refreshToken}`} publicKey={publicKey} network={network} onShowDetails={onShowDetails} onWithdraw={onWithdraw} />;
  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40" data-testid="pool-positions">
      <h2 className="mb-2 text-lg font-semibold">{t('liquidity:positions.title')}</h2>
      {body}
    </section>
  );
}
