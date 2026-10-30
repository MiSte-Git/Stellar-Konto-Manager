import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmountWithUnit } from '../liquidity/formatPoolAmount.js';
import useIdentityRound from './hooks/useIdentityRound.js';

function RoundIncoming({ round, locale }) {
  const { t } = useTranslation(['groupfund']);
  const { scanning, unavailable, native, others, isPartial, result } = round;
  if (!result || unavailable) {
    return <span className={scanning ? 'animate-pulse' : ''}>{unavailable ? t('groupfund:header.unavailable') : t('groupfund:header.loading')}</span>;
  }
  const amount = formatAmountWithUnit(native?.gross ?? 0n, 'XLM', locale);
  const partial = isPartial(native) || others.some(isPartial);
  return (
    <span className={`font-mono ${scanning ? 'animate-pulse' : ''}`} aria-busy={scanning}>
      {partial ? t('groupfund:summary.atLeast', { amount }) : amount}
      {others.length > 0 && ` ${t('groupfund:header.more', { count: others.length })}`}
    </span>
  );
}

/**
 * Zeilen des Kopfbereichs im Identitaetsmodus. Das Guthaben steht beim Basis-G-Konto,
 * zur M-Adresse gehoeren nur die Eingaenge der aktuellen Runde.
 */
export default function IdentityHeaderRows({ publicKey, muxedAddress, muxedId, network, balanceText, accountMissing = false }) {
  const { t, i18n } = useTranslation(['common', 'groupfund']);
  const round = useIdentityRound({ publicKey, muxedAddress, network, accountMissing });
  return (
    <div className="mt-1 space-y-0.5" data-testid="identity-header">
      <div>
        <span className="font-semibold">{t('common:accountMode.muxedAddress', 'Muxed address')}:</span>{' '}
        <span className="font-mono break-all">{muxedAddress}</span>
      </div>
      {muxedId && (
        <div data-testid="identity-header-round">
          <span className="font-semibold">{t('common:accountMode.muxedId', 'Muxed ID')}:</span>{' '}
          <span className="font-mono break-all">{muxedId}</span>
          {' · '}
          <span className="font-semibold">{t('groupfund:header.incoming')}:</span>{' '}
          <RoundIncoming round={round} locale={i18n.language} />
        </div>
      )}
      <div data-testid="identity-header-base">
        <span className="font-semibold">{t('common:accountMode.baseAccount', 'Base G account')}:</span>{' '}
        <span className="font-mono break-all">{publicKey}</span>
        {' · '}
        <span className="font-semibold">{t('groupfund:header.balance')}:</span>{' '}
        <span className="font-mono">{balanceText}</span>
      </div>
    </div>
  );
}
