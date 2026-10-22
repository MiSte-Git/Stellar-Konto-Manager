import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from '../layout/NavIcon.jsx';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { buildExplorerUrl } from '../../utils/stellar/accountUtils.js';
import {
  findLookalikeCounterparties,
  isDust,
  isValidTxHash,
  looksLikeNativeCode,
  matchesMuxed,
  memoLooksLikeUrl,
  normalizeActivity,
  safeHttpUrl,
} from '../../utils/stellar/activity.js';
import { shortenAddress } from '../../utils/stellar/walletSummary.js';
import { readHideDust, writeHideDust } from '../../utils/stellar/dustPreference.js';
import { ActivityNotices, DustBadge, FakeNativeBadge, LookalikeBadge, UrlBadge } from './ActivityWarnings.jsx';
import { useSettings } from '../../utils/useSettings.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';
const FETCH_LIMIT = 30;
const SHOW_LIMIT = 8;
function useRecentPayments(publicKey, network, reloadToken) {
  const [state, setState] = React.useState({ loading: false, error: '', records: [] });

  React.useEffect(() => {
    if (!publicKey) {
      setState({ loading: false, error: '', records: [] });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    const server = getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN);
    server
      .payments()
      .forAccount(publicKey)
      .order('desc')
      .limit(FETCH_LIMIT)
      .join('transactions')
      .call()
      .then((page) => {
        if (!cancelled) setState({ loading: false, error: '', records: page?.records || [] });
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status || err?.status;
        // 404: Konto (noch) nicht vorhanden -> einfach keine Aktivitaet
        setState({ loading: false, error: status === 404 ? '' : String(err?.message || err || ''), records: [] });
      });
    return () => { cancelled = true; };
  }, [publicKey, network, reloadToken]);

  return state;
}

/**
 * Letzte Ein- und Ausgaenge des geladenen Kontos.
 * Memos werden ausschliesslich als bereinigter Text gerendert (nie als Link/HTML).
 * @param {{ publicKey: string, muxedAddress?: string, network: 'PUBLIC'|'TESTNET', reloadToken?: number,
 *   locale?: string, fmt: (n: number, o?: object) => string, onShowAll?: () => void }} props
 */
export default function RecentActivity({ publicKey, muxedAddress, network, reloadToken, locale, fmt, onShowAll }) {
  const { t } = useTranslation(['wallet']);
  const { explorers, defaultExplorerKey } = useSettings();
  const [hideDust, setHideDust] = React.useState(readHideDust);
  const { loading, error, records } = useRecentPayments(publicKey, network, reloadToken);

  const items = React.useMemo(
    () => records
      .filter((r) => matchesMuxed(r, muxedAddress))
      .map((r) => normalizeActivity(r, publicKey))
      .filter(Boolean),
    [records, muxedAddress, publicKey]
  );
  const lookalikes = React.useMemo(() => findLookalikeCounterparties(items), [items]);
  const dustCount = React.useMemo(() => items.filter(isDust).length, [items]);
  const visible = React.useMemo(
    () => (hideDust ? items.filter((i) => !isDust(i)) : items).slice(0, SHOW_LIMIT),
    [hideDust, items]
  );

  const explorer = React.useMemo(
    () => (explorers || []).find((e) => e.key === defaultExplorerKey) || (explorers || [])[0] || null,
    [explorers, defaultExplorerKey]
  );

  const dateFmt = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return null;
    }
  }, [locale]);

  const toggleDust = () => {
    setHideDust((prev) => {
      const next = !prev;
      writeHideDust(next);
      return next;
    });
  };

  const titleFor = (item) => {
    if (item.kind === 'createAccount') {
      return item.direction === 'in'
        ? t('wallet:activity.kind.accountCreated', 'Konto aktiviert')
        : t('wallet:activity.kind.createdAccount', 'Konto erstellt');
    }
    if (item.kind === 'accountMerge') {
      return item.direction === 'in'
        ? t('wallet:activity.kind.mergeIn', 'Konto zusammengeführt')
        : t('wallet:activity.kind.mergeOut', 'Konto aufgelöst');
    }
    if (item.direction === 'self') return t('wallet:activity.kind.self', 'An dich selbst');
    if (item.kind === 'pathPayment') {
      return item.direction === 'in'
        ? t('wallet:activity.kind.pathIn', 'Erhalten (umgetauscht)')
        : t('wallet:activity.kind.pathOut', 'Gesendet (umgetauscht)');
    }
    return item.direction === 'in'
      ? t('wallet:activity.kind.received', 'Erhalten')
      : t('wallet:activity.kind.sent', 'Gesendet');
  };

  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/70"
      data-testid="recent-activity"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:activity.title', 'Letzte Aktivität')}</h2>
        {onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-gray-700 dark:hover:text-blue-200"
          >
            {t('wallet:activity.showAll', 'Alle anzeigen')}
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-3 px-5 py-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700/60" />
          ))}
        </div>
      ) : error ? (
        <p className="px-5 py-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {t('wallet:activity.loadError', 'Aktivität konnte nicht geladen werden.')}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
          {dustCount > 0
            ? t('wallet:activity.onlyDust', 'Nur Kleinstzahlungen vorhanden.')
            : t('wallet:activity.empty', 'Noch keine Zahlungen.')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/70">
          {visible.map((item) => {
            const incoming = item.direction === 'in';
            const suspicious = incoming && lookalikes.has(item.counterparty);
            const dust = isDust(item);
            const href = isValidTxHash(item.hash) && explorer
              ? safeHttpUrl(buildExplorerUrl(explorer, item.hash, network, { type: 'tx' }))
              : '';
            const parsedDate = item.createdAt ? new Date(item.createdAt) : null;
            const date = parsedDate && dateFmt && !Number.isNaN(parsedDate.getTime()) ? dateFmt.format(parsedDate) : '';
            const urlInMemo = memoLooksLikeUrl(item.memo);
            const fakeNative = looksLikeNativeCode(item.asset);
            const warn = suspicious || dust || urlInMemo || fakeNative;
            const sign = incoming ? '+' : item.direction === 'out' ? '−' : '';
            return (
              <li key={item.id || item.hash} className="flex items-start gap-3 px-5 py-3" data-testid="activity-item">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    incoming
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  <NavIcon name={incoming ? 'receive' : 'send'} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{titleFor(item)}</span>
                    {!item.successful && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                        {t('wallet:activity.failed', 'Fehlgeschlagen')}
                      </span>
                    )}
                    {suspicious && <LookalikeBadge />}
                    {dust && <DustBadge />}
                    {urlInMemo && <UrlBadge />}
                    {fakeNative && <FakeNativeBadge />}
                  </div>
                  {item.counterparty && item.direction !== 'self' && (
                    <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={item.counterparty}>
                      {incoming ? t('wallet:activity.from', 'von') : t('wallet:activity.to', 'an')} {shortenAddress(item.counterparty, 6, 6)}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                    {date && <span>{date}</span>}
                    {item.memo && (
                      <span className="min-w-0 break-all" title={t('wallet:activity.memoHint', 'Memo vom Absender. Inhalt nicht von SKM geprüft.')}>
                        · {item.memoType === 'text'
                          ? t('wallet:activity.memoLabel', 'Memo')
                          : `${t('wallet:activity.memoLabel', 'Memo')} (${item.memoType.toUpperCase()})`}
                        : „{item.memo}“
                      </span>
                    )}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                      >
                        · {t('wallet:activity.explorer', 'Details')}
                      </a>
                    )}
                  </div>
                </div>
                <div
                  className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${
                    incoming && !warn
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : incoming
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-gray-900 dark:text-white'
                  }`}
                >
                  {item.amount != null ? `${sign}${fmt(item.amount, { min: 0, max: 7 })}` : '—'}
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {item.asset.code}
                    {!item.asset.isNative && item.asset.issuer && (
                      <span className="block font-mono text-[10px]" title={item.asset.issuer}>
                        {shortenAddress(item.asset.issuer, 6, 6)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ActivityNotices
        dustCount={dustCount}
        hideDust={hideDust}
        onToggleDust={toggleDust}
        hasLookalikes={lookalikes.size > 0}
      />
    </section>
  );
}
