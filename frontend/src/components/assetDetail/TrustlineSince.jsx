import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServerForNetwork } from '../../utils/stellar/stellarUtils.js';
import { findTrustlineSince, MAX_PAGES } from '../../utils/stellar/trustlineSince.js';

/**
 * Trustline-Datum auf Knopfdruck. Eltern setzen key aus Netz, Konto und Asset, damit ein Wechsel frisch startet.
 * formatDate: Datum mit Uhrzeit wie die anderen Angaben der Seite.
 */
export default function TrustlineSince({ account, code, issuer, network, formatDate }) {
  const { t } = useTranslation(['wallet']);
  const [state, setState] = useState({ status: 'idle' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const search = async () => {
    setState({ status: 'loading', page: 0 });
    try {
      const result = await findTrustlineSince({
        server: getHorizonServerForNetwork(network),
        account, code, issuer,
        onProgress: (page) => { if (alive.current) setState({ status: 'loading', page }); },
        isCancelled: () => !alive.current,
      });
      if (alive.current && result) setState(result);
    } catch {
      if (alive.current) setState({ status: 'error' });
    }
  };

  const date = (v) => (v ? formatDate(v) : '–');
  let content;
  switch (state.status) {
    case 'loading':
      content = <span aria-busy="true">{t('wallet:assetDetail.trustlineSince.loading', { page: state.page, max: MAX_PAGES, defaultValue: 'Suche im Verlauf … (Seite {{page}} von höchstens {{max}})' })}</span>;
      break;
    case 'found':
      content = <span data-testid="trustline-since-date">{date(state.at)}</span>;
      break;
    case 'olderThan':
      content = <span data-testid="trustline-since-older">{t('wallet:assetDetail.trustlineSince.olderThan', { date: date(state.oldest), defaultValue: 'älter als {{date}}' })}</span>;
      break;
    case 'notInHistory':
      content = (
        <span data-testid="trustline-since-none">
          {state.oldest
            ? t('wallet:assetDetail.trustlineSince.notInHistory', { date: date(state.oldest), defaultValue: 'nicht im verfügbaren Verlauf (ältester Eintrag {{date}})' })
            : t('wallet:assetDetail.trustlineSince.noHistory', 'nicht im verfügbaren Verlauf')}
        </span>
      );
      break;
    case 'error':
      content = <span data-testid="trustline-since-error">{t('wallet:assetDetail.trustlineSince.error', 'konnte nicht geladen werden')}</span>;
      break;
    default:
      content = null;
  }
  const canSearch = state.status === 'idle' || state.status === 'error';
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.trustlineSince.label', 'Trustline angelegt')}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-sm text-gray-900 dark:text-gray-100">
        {content}
        {canSearch && (
          <button
            type="button"
            onClick={search}
            className="rounded-sm border border-gray-300 px-2 py-0.5 font-sans text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="trustline-since-search"
          >
            {state.status === 'error'
              ? t('wallet:assetDetail.trustlineSince.retry', 'Erneut suchen')
              : t('wallet:assetDetail.trustlineSince.search', 'Datum suchen')}
          </button>
        )}
      </dd>
    </div>
  );
}
