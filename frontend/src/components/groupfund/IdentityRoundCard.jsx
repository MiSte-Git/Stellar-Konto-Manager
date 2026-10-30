import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../../utils/datetime';
import { assetUnitLabel } from '../../utils/stellar/groupfundAggregate.js';
import { formatAmountWithUnit } from '../liquidity/formatPoolAmount.js';
import useIdentityRound from './hooks/useIdentityRound.js';

const FACT_LABEL = 'text-xs text-gray-500 dark:text-gray-400';
const FACT_VALUE = 'mt-0.5 font-medium tabular-nums text-gray-900 dark:text-gray-100';

/**
 * Inhalt der Startseiten-Karte im Identitaetsmodus: Eine M-Adresse hat kein eigenes
 * Guthaben, gross stehen deshalb die Eingaenge der aktuellen Runde. Der G-Saldo steht
 * abgesetzt darunter und ist vom Scan unabhaengig, auch bei einem Scan-Fehler.
 */
export default function IdentityRoundCard({ publicKey, muxedAddress, network, locale, summary, fmt, fiat, refreshToken, onOpenDetails }) {
  const { t } = useTranslation(['groupfund', 'wallet']);
  const identity = useIdentityRound({ publicKey, muxedAddress, network });
  const { scanning, failed, limited, round, result, native, others, isPartial, refresh } = identity;

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current === refreshToken) return;
    lastToken.current = refreshToken;
    void refreshRef.current();
  }, [refreshToken]);

  const money = (stroops, asset) => formatAmountWithUnit(stroops, assetUnitLabel(asset), locale);
  const gross = (total) => (isPartial(total)
    ? t('groupfund:summary.atLeast', { amount: money(total.gross, total.asset) })
    : money(total.gross, total.asset));
  const net = (total) => (isPartial(total)
    ? t('groupfund:senders.netIncomplete', { amount: money(total.net, total.asset) })
    : money(total.net, total.asset));
  const totals = result?.totals || [];
  const withRefunds = totals.filter((total) => total.refunds > 0n);
  const withUnmarked = totals.filter((total) => total.unmarkedOut > 0n);
  const nativeAmount = formatAmountWithUnit(native?.gross ?? 0n, 'XLM', locale);
  const baseTotal = fiat(summary.xlm);

  return (
    <>
      {result ? (
        <div className="mt-2" data-testid="identity-round" aria-busy={scanning}>
          <div className={`text-3xl font-semibold tabular-nums tracking-tight text-gray-900 sm:text-4xl dark:text-white ${scanning ? 'animate-pulse' : ''}`} data-testid="identity-round-xlm">
            {isPartial(native) ? t('groupfund:summary.atLeast', { amount: nativeAmount }) : nativeAmount}
          </div>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="identity-round-since">
            {round.start
              ? t('groupfund:card.since', { time: formatLocalDateTime(round.start.createdAt) })
              : t('groupfund:card.sinceHistory')}
          </div>
          {others.length > 0 && (
            <ul className="mt-2 text-sm tabular-nums" data-testid="identity-round-others">
              {others.map((total) => <li key={total.key}>{gross(total)}</li>)}
            </ul>
          )}
          {withRefunds.length > 0 && (
            <dl className="mt-2 text-sm" data-testid="identity-round-net">
              {withRefunds.map((total) => (
                <div key={total.key} className="flex flex-wrap gap-x-2">
                  <dt className={FACT_LABEL}>{t('groupfund:senders.net')}</dt>
                  <dd className="tabular-nums">{net(total)}</dd>
                </div>
              ))}
            </dl>
          )}
          {withUnmarked.length > 0 && (
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300" data-testid="identity-round-unmarked">
              {withUnmarked.map((total) => (
                <div key={total.key} className="tabular-nums">{t('groupfund:senders.unmarkedOut')}: {money(total.unmarkedOut, total.asset)}</div>
              ))}
              <p>{t('groupfund:card.unmarkedHint')}</p>
            </div>
          )}
          {result.amountUnknownCount > 0 && (
            <p className="mt-2 text-xs text-amber-900 dark:text-amber-200" data-testid="identity-round-unknown">
              {t('groupfund:notes.amountUnknown', { count: result.amountUnknownCount })}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2" aria-busy={scanning} data-testid="identity-round-pending">
          {failed ? null : <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />}
        </div>
      )}
      {failed && <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert" data-testid="identity-round-failed">{t('groupfund:card.failed')}</p>}
      {limited && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300" data-testid="identity-round-limited">{t('groupfund:card.limited')}</p>}
      <button
        type="button"
        onClick={onOpenDetails}
        className="mt-2 border-0 bg-transparent p-0 text-xs font-medium text-blue-700 underline hover:no-underline dark:text-blue-300"
      >
        {t('groupfund:card.details')}
      </button>

      <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700/70" data-testid="identity-base-balance">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('groupfund:card.baseTitle')}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{t('groupfund:card.baseShared')}</div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className={FACT_LABEL}>{t('groupfund:card.baseTotal')}</dt>
            <dd className={FACT_VALUE}>
              {fmt(summary.xlm, { min: 2, max: 7 })} XLM
              {baseTotal && <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">≈ {baseTotal}</span>}
            </dd>
          </div>
          <div>
            <dt className={FACT_LABEL}>{t('wallet:home.available', 'Verfügbar')}</dt>
            <dd className={FACT_VALUE}>{fmt(summary.available, { min: 2, max: 7 })} XLM</dd>
          </div>
          <div>
            <dt className={FACT_LABEL}>{t('wallet:home.reserved', 'Reserviert')}</dt>
            <dd className={FACT_VALUE}>{fmt(summary.minReserve + summary.sellingLiabilities, { min: 1, max: 7 })} XLM</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
