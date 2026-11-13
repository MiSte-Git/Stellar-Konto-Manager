import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ClearInputButton from '../ClearInputButton.jsx';
import { matchesAssetQuery } from '../../utils/stellar/assetFilter.js';
import { DEFAULT_HIDE_OPTIONS, isTokenHidden, tokenKey, tokensFromAccount } from './accountTokens.js';
import useTokenFlags from './hooks/useTokenFlags.js';
import { shortenKey } from './assetSearchUtils.js';

const btnCls = 'rounded-sm border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800';

/**
 * Token suchen und handeln, Modus Im Konto: alle Token des geladenen Kontos mit Saldo, lokal filterbar
 * (assetFilter.js), je Token Details (Asset-Detailseite) und Handeln (Detailansicht im Trading).
 * Ausblende-Filter (Saldo 0, kein Marktpreis gegen XLM, SCAM-Eintrag bei StellarExpert) ist
 * standardmaessig aus; geprueft wird erst, wenn er an ist. Nur Anzeige, sendet nichts.
 */
export default function AccountTokenList({ account, accountId, accountLoading = false, network, onTrade, onOpenDetails }) {
  const { t, i18n } = useTranslation(['trading', 'common']);
  const [query, setQuery] = useState('');
  const [hide, setHide] = useState(DEFAULT_HIDE_OPTIONS);
  const tokens = useMemo(() => tokensFromAccount(account), [account]);
  const flags = useTokenFlags(tokens, network, {
    scam: hide.enabled && hide.scam,
    market: hide.enabled && hide.noMarket,
  });

  const nf = useMemo(() => {
    try { return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 7 }); } catch { return null; }
  }, [i18n.language]);
  const fmt = (v) => (nf ? nf.format(Number(v)) : String(v));

  const matching = useMemo(() => tokens.filter((tk) => matchesAssetQuery(tk, query)), [tokens, query]);
  const visible = useMemo(() => matching.filter((tk) => !isTokenHidden(tk, hide, flags)), [matching, hide, flags]);
  const hiddenCount = matching.length - visible.length;
  const pending = hide.enabled && [
    ...(hide.scam ? Object.values(flags.scam) : []),
    ...(hide.noMarket ? Object.values(flags.market) : []),
  ].filter((v) => v === 'loading').length;

  if (!accountId) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="account-tokens-noaccount">
        {t('trading:accountTokens.noAccount', 'Kein Konto geladen. Lade oben ein Konto oder suche auf der Blockchain.')}
      </p>
    );
  }
  if (!account) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300" aria-busy={accountLoading ? 'true' : undefined}>
        {t('trading:accountTokens.loading', 'Token des Kontos werden geladen …')}
      </p>
    );
  }

  const setOpt = (key) => (e) => setHide((prev) => ({ ...prev, [key]: e.target.checked }));

  return (
    <section className="space-y-3" data-testid="account-tokens">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('trading:accountTokens.filterPlaceholder', 'Token im Konto filtern: Code, Issuer oder CODE:ISSUER')}
          aria-label={t('trading:accountTokens.filterLabel', 'Token im Konto filtern')}
          data-testid="account-tokens-filter"
          className="w-full rounded-sm border border-gray-300 px-3 py-2 pr-9 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        {query && <ClearInputButton onClick={() => setQuery('')} />}
      </div>

      <div className="rounded-sm border border-gray-200 px-3 py-2 text-xs dark:border-gray-700">
        <label className="inline-flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={hide.enabled} onChange={setOpt('enabled')} data-testid="account-tokens-hide" />
          {t('trading:accountTokens.hide.toggle', 'Token ausblenden')}
        </label>
        {hide.enabled && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={hide.scam} onChange={setOpt('scam')} data-testid="account-tokens-hide-scam" />
              {t('trading:accountTokens.hide.scam', 'Mit Warnung bei StellarExpert (SCAM, unsicher)')}
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={hide.zero} onChange={setOpt('zero')} data-testid="account-tokens-hide-zero" />
              {t('trading:accountTokens.hide.zero', 'Saldo 0')}
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={hide.noMarket} onChange={setOpt('noMarket')} data-testid="account-tokens-hide-market" />
              {t('trading:accountTokens.hide.noMarket', 'Kein Marktpreis gegen XLM')}
            </label>
          </div>
        )}
        {hide.enabled && pending > 0 && (
          <p className="mt-1 text-gray-600 dark:text-gray-300" data-testid="account-tokens-pending">
            {t('trading:accountTokens.hide.pending', { count: pending, defaultValue: 'Prüfe noch {{count}} Einträge …' })}
          </p>
        )}
        {hide.enabled && (
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {t('trading:accountTokens.hide.note', 'Ausgeblendet wird nur bei sicherem Befund. Nicht prüfbare Token bleiben sichtbar. Der StellarExpert-Eintrag ist ein Hinweis eines Drittanbieters, kein Echtheitsbeweis.')}
          </p>
        )}
      </div>

      <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="account-tokens-count">
        {hiddenCount > 0
          ? t('trading:accountTokens.countHidden', { shown: visible.length, total: tokens.length, hidden: hiddenCount, defaultValue: '{{shown}} von {{total}} Token, {{hidden}} ausgeblendet' })
          : t('trading:accountTokens.count', { shown: visible.length, total: tokens.length, defaultValue: '{{shown}} von {{total}} Token' })}
      </p>

      {tokens.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="account-tokens-empty">
          {t('trading:accountTokens.none', 'Dieses Konto hat noch keine Token. Suche auf der Blockchain, um einen zu finden.')}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="account-tokens-nomatch">
          {t('trading:accountTokens.noMatch', 'Kein Token passt zum Filter.')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-sm border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {visible.map((tk) => {
            const scamFlag = flags.scam[tk.issuer] === 'yes';
            const noMarket = flags.market[tokenKey(tk)] === 'no';
            return (
              <li key={tokenKey(tk)} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="account-token">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    <span data-testid="account-token-code">{tk.code}</span>
                    {scamFlag && (
                      <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                        {t('trading:accountTokens.badge.scam', 'Warnung StellarExpert')}
                      </span>
                    )}
                    {noMarket && (
                      <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                        {t('trading:accountTokens.badge.noMarket', 'Kein Marktpreis')}
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={tk.issuer}>{shortenKey(tk.issuer)}</div>
                </div>
                <div className="tabular-nums">{fmt(tk.balance)}</div>
                <div className="flex gap-1">
                  {onOpenDetails && (
                    <button type="button" className={btnCls} onClick={() => onOpenDetails(tk)} aria-label={t('trading:accountTokens.detailsAria', { code: tk.code, defaultValue: 'Details zu {{code}}' })}>
                      {t('trading:accountTokens.details', 'Details')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-sm bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                    onClick={() => onTrade(tk)}
                    aria-label={t('trading:accountTokens.tradeAria', { code: tk.code, defaultValue: '{{code}} handeln' })}
                  >
                    {t('trading:accountTokens.trade', 'Handeln')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
