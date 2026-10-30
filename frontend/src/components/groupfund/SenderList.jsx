import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../../utils/datetime';
import { buildExplorerUrl } from '../../utils/stellar/accountUtils.js';
import { looksLikeNativeCode, safeHttpUrl } from '../../utils/stellar/activity.js';
import { isExchangeEntry } from '../../utils/expert/expertDirectory.js';
import { useSettings } from '../../utils/useSettings.js';
import { DirectoryTagBadge, DustBadge, FakeNativeBadge, LookalikeBadge } from '../wallet/ActivityWarnings.jsx';
import { formatAmountWithUnit } from '../liquidity/formatPoolAmount.js';
import { assetUnitLabel } from '../../utils/stellar/groupfundAggregate.js';

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-600 dark:text-gray-300">{label}</dt>
      <dd className="break-words font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** Liste pro Absender und Asset. Als Karten statt Tabelle, damit sie auf schmalen Geraeten ohne Scrollen bleibt. */
export default function SenderList({ rows, network, locale, directory, lookalikes }) {
  const { t } = useTranslation(['groupfund']);
  const { explorers, defaultExplorerKey } = useSettings();
  const explorer = (explorers || []).find((e) => e.key === defaultExplorerKey) || (explorers || [])[0] || null;
  const txUrl = (hash) => safeHttpUrl(buildExplorerUrl(explorer, hash, network, { type: 'tx' }));

  return (
    <ul className="space-y-2" data-testid="groupfund-senders">
      {rows.map((row) => {
        const unit = assetUnitLabel(row.asset);
        const entry = directory.get(row.sender);
        const amount = (value) => formatAmountWithUnit(value, unit, locale);
        return (
          <li key={row.key} className="rounded-sm border border-gray-200 p-3 text-xs dark:border-gray-700" data-testid="groupfund-sender">
            <div className="flex flex-wrap items-center gap-1">
              <span className="break-all font-mono text-sm">{row.sender}</span>
              {lookalikes.has(row.sender) && <LookalikeBadge />}
              {row.dustCount > 0 && <DustBadge />}
              {looksLikeNativeCode(row.asset) && <FakeNativeBadge />}
              {(entry?.tags || []).map((tag) => <DirectoryTagBadge key={tag} tag={tag} />)}
            </div>
            {isExchangeEntry(entry) && (
              <p className="mt-1 text-amber-900 dark:text-amber-200" data-testid="groupfund-exchange-hint">
                {t('groupfund:senders.exchangeHint', { tag: 'exchange' })}
                {entry.name && ` ${t('groupfund:senders.directoryName', { name: entry.name })}`}
              </p>
            )}
            {row.amountUnknown && (
              <p className="mt-1 text-amber-900 dark:text-amber-200" data-testid="groupfund-amount-unknown">{t('groupfund:senders.amountUnknown')}</p>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Fact label={t('groupfund:senders.gross')}>{row.amountUnknown ? t('groupfund:senders.atLeast', { amount: amount(row.gross) }) : amount(row.gross)}</Fact>
              <Fact label={t('groupfund:senders.refunds')}>{amount(row.refunds)}</Fact>
              <Fact label={t('groupfund:senders.net')}>{row.amountUnknown ? t('groupfund:senders.netIncomplete', { amount: amount(row.net) }) : amount(row.net)}</Fact>
              <Fact label={t('groupfund:senders.unmarkedOut')}>{amount(row.unmarkedOut)}</Fact>
              <Fact label={t('groupfund:senders.count')}>{row.count}</Fact>
              <Fact label={t('groupfund:senders.first')}>{row.firstAt ? formatLocalDateTime(row.firstAt) : '—'}</Fact>
              <Fact label={t('groupfund:senders.last')}>{row.lastAt ? formatLocalDateTime(row.lastAt) : '—'}</Fact>
            </dl>
            {row.txHashes.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer">{t('groupfund:senders.txHashes', { count: row.txHashes.length })}</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {row.txHashes.map((hash) => {
                    const href = txUrl(hash);
                    return (
                      <li key={hash} className="break-all">
                        {href
                          ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:no-underline dark:text-blue-300">{hash}</a>
                          : hash}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
