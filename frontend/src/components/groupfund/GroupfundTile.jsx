import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../../utils/datetime';
import { extractMuxedIdFromAddress } from '../../utils/stellar/stellarUtils.js';
import { assetUnitLabel } from '../../utils/stellar/groupfundAggregate.js';
import { formatAmountWithUnit } from '../liquidity/formatPoolAmount.js';
import { getGroupfundSummary } from './hooks/useGroupfundScan.js';

function muxedIdOf(address) {
  try {
    return extractMuxedIdFromAddress(address);
  } catch {
    return '';
  }
}

/**
 * Kachel auf der Startseite im Identitaetsmodus. Scannt nicht selbst, sonst wuerde jeder
 * Aufruf der Startseite mehrere Horizon-Seiten laden: Sie zeigt nur eine Rundensumme, die
 * in dieser Sitzung schon auf der Detailseite ermittelt wurde.
 */
export default function GroupfundTile({ publicKey, muxedAddress, network, locale, onOpen }) {
  const { t } = useTranslation(['groupfund']);
  const summary = getGroupfundSummary(network, publicKey);
  const own = summary?.identifierKey === `muxed:${muxedIdOf(muxedAddress)}` ? summary : null;
  const totals = own?.totals;
  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-left dark:border-gray-700 dark:bg-gray-800" data-testid="groupfund-tile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('groupfund:tile.title')}</h2>
        <button type="button" onClick={onOpen} className="text-sm text-blue-700 underline hover:no-underline dark:text-blue-300">
          {t('groupfund:tile.open')}
        </button>
      </div>
      {own?.incomplete && (
        <p className="mt-1 text-xs text-amber-900 dark:text-amber-200" data-testid="groupfund-tile-incomplete">
          {t('groupfund:tile.incomplete')}{' '}
          <button type="button" onClick={onOpen} className="underline hover:no-underline">{t('groupfund:tile.details')}</button>
        </p>
      )}
      {!own?.incomplete && totals?.length > 0 && (
        <>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{t('groupfund:tile.stand', { time: formatLocalDateTime(summary.at) })}</p>
          <ul className="mt-1 text-sm tabular-nums">
            {totals.map((total) => (
              <li key={total.key}>{formatAmountWithUnit(total.gross, assetUnitLabel(total.asset), locale)}</li>
            ))}
          </ul>
        </>
      )}
      {!own?.incomplete && !totals?.length && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{t('groupfund:tile.hint')}</p>}
    </section>
  );
}
