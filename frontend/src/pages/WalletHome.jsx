import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from '../components/layout/NavIcon.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { computeWalletSummary, shortenAddress } from '../utils/stellar/walletSummary.js';
import { useSettings } from '../utils/useSettings.js';
import { useXlmPriceData } from '../utils/xlmPriceContext.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';

function readNetwork() {
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

const EMPTY_STATE = { loading: false, error: '', notFound: false, account: null };

/** Laedt das Konto (nur loadAccount, keine Zahlungsliste) und folgt Netzwechseln. */
function useAccountOverview(publicKey, reloadToken) {
  const [network, setNetwork] = React.useState(readNetwork);
  const [state, setState] = React.useState(EMPTY_STATE);

  React.useEffect(() => {
    const handler = (e) => setNetwork(typeof e?.detail === 'string' && e.detail === 'TESTNET' ? 'TESTNET' : readNetwork());
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  React.useEffect(() => {
    if (!publicKey) {
      setState(EMPTY_STATE);
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '', notFound: false }));
    const server = getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN);
    server
      .loadAccount(publicKey)
      .then((account) => {
        if (!cancelled) setState({ loading: false, error: '', notFound: false, account });
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status || err?.status;
        setState({
          loading: false,
          account: null,
          notFound: status === 404,
          error: status === 404 ? '' : String(err?.message || err || ''),
        });
      });
    return () => { cancelled = true; };
  }, [publicKey, network, reloadToken]);

  return { ...state, network };
}

function AssetAvatar({ label, native = false }) {
  const text = (label || '?').slice(0, native ? 3 : 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        native
          ? 'bg-gradient-to-br from-sky-400 to-indigo-600 text-white'
          : 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600'
      }`}
    >
      {text}
    </span>
  );
}

function ActionButton({ icon, label, onClick, primary = false }) {
  const cls = primary
    ? 'border-0 bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500'
    : 'border border-gray-200 bg-white text-gray-800 hover:border-gray-300 hover:bg-gray-50 ' +
      'dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-500 dark:hover:bg-gray-800';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold shadow-sm sm:flex-row sm:gap-2 sm:px-4 sm:text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${cls}`}
    >
      <NavIcon name={icon} className="h-4 w-4" />
      {label}
    </button>
  );
}

const cardCls =
  'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/70';

/**
 * Wallet-Startseite: Guthaben, Aktionen und Asset-Liste des geladenen Kontos.
 * @param {{ publicKey?: string, muxedAddress?: string, onAction: (id: string) => void, onOpenRoute?: (path: string) => void }} props
 */
export default function WalletHome({ publicKey, muxedAddress, onAction, onOpenRoute }) {
  const { t, i18n } = useTranslation(['wallet', 'menu', 'network', 'common']);
  const { decimalsMode } = useSettings();
  const price = useXlmPriceData();
  const [reloadToken, setReloadToken] = React.useState(0);
  const { loading, error, notFound, account, network } = useAccountOverview(publicKey, reloadToken);
  const summary = React.useMemo(() => computeWalletSummary(account), [account]);

  const locale = price?.locale || i18n.language || undefined;
  const fmt = React.useCallback((value, { min = 0, max = 7 } = {}) => {
    const fixed = decimalsMode && decimalsMode !== 'auto' ? Number(decimalsMode) : null;
    const opts = fixed == null
      ? { minimumFractionDigits: min, maximumFractionDigits: max }
      : { minimumFractionDigits: fixed, maximumFractionDigits: fixed };
    try {
      return new Intl.NumberFormat(locale, opts).format(value);
    } catch {
      return String(value);
    }
  }, [decimalsMode, locale]);

  const fiat = React.useCallback((xlmAmount) => {
    if (!price || price.value == null || xlmAmount == null) return null;
    try {
      const f = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${price.symbol}${f.format(xlmAmount * price.value)}`;
    } catch {
      return null;
    }
  }, [locale, price]);

  const netName = network === 'TESTNET' ? t('network:testnet', 'Testnet') : t('network:mainnet', 'Mainnet');

  // Leerzustand: noch kein Konto geladen
  if (!publicKey) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-10 text-left">
        <section className={`${cardCls} p-6 sm:p-8`} data-testid="wallet-home-empty">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <NavIcon name="wallet" className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t('wallet:home.empty.title', 'Noch kein Konto geladen')}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {t('wallet:home.empty.text', 'Gib oben deinen Public Key oder eine Föderationsadresse ein. Zum Ansehen reicht der Public Key, für Transaktionen brauchst du später deinen Secret Key.')}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <ActionButton icon="plusCircle" label={t('menu:createAccount', 'Neues Konto erstellen')} onClick={() => onAction?.('createAccount')} />
            {onOpenRoute && (
              <ActionButton icon="compass" label={t('wallet:home.empty.learn', 'Stellar kennenlernen')} onClick={() => onOpenRoute('discover')} />
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 text-left" data-testid="wallet-home">
      {/* Guthaben + Aktionen */}
      <section className={`${cardCls} p-5 sm:p-6`}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('wallet:home.balance', 'Guthaben')}
          </div>
          <button
            type="button"
            onClick={() => setReloadToken((v) => v + 1)}
            disabled={loading}
            aria-label={t('wallet:home.refresh', 'Aktualisieren')}
            title={t('wallet:home.refresh', 'Aktualisieren')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <NavIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {notFound ? (
          <div className="mt-3" data-testid="wallet-home-notfound">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('wallet:home.notFound.title', 'Konto noch nicht aktiviert')}
            </div>
            <p className="mt-1 max-w-xl text-sm text-gray-600 dark:text-gray-300">
              {t('wallet:home.notFound.text', {
                net: netName,
                defaultValue: 'Dieses Konto existiert im {{net}} noch nicht. Es wird aktiv, sobald es eine erste Einzahlung in XLM erhält.',
              })}
            </p>
          </div>
        ) : error && !summary ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {t('wallet:home.loadError', 'Kontodaten konnten nicht geladen werden.')}
          </p>
        ) : !summary ? (
          <div className="mt-3 space-y-2" aria-busy="true">
            <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-gray-900 sm:text-4xl dark:text-white" data-testid="wallet-home-xlm">
                {fmt(summary.xlm, { min: 2, max: 7 })}
              </span>
              <span className="text-lg font-medium text-gray-500 dark:text-gray-400">XLM</span>
            </div>
            <div className="mt-1 min-h-[1.25rem] text-sm tabular-nums text-gray-500 dark:text-gray-400">
              {fiat(summary.xlm) ? `≈ ${fiat(summary.xlm)}` : ''}
            </div>
            <dl className="mt-4 grid max-w-md grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:home.available', 'Verfügbar')}</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(summary.available, { min: 2, max: 7 })} XLM
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400" title={t('wallet:home.reservedHint', 'Mindestreserve des Netzwerks (pro Token-Freigabe, Angebot oder Unterzeichner) plus XLM in offenen Verkaufsangeboten. Dieser Betrag kann nicht gesendet werden.')}>
                  {t('wallet:home.reserved', 'Reserviert')}
                  <span aria-hidden="true" className="ml-1 cursor-help text-gray-400">ⓘ</span>
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(summary.minReserve + summary.sellingLiabilities, { min: 1, max: 7 })} XLM
                </dd>
              </div>
            </dl>
          </>
        )}

        {muxedAddress && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {t('wallet:home.muxedNote', 'Muxed-Identität: angezeigt wird das Guthaben des Basiskontos.')}
          </p>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <ActionButton primary icon="send" label={t('wallet:home.actions.send', 'Senden')} onClick={() => onAction?.('sendPayment')} />
          <ActionButton icon="swap" label={t('wallet:home.actions.swap', 'Tauschen')} onClick={() => onAction?.('tradingAssets')} />
          <ActionButton icon="list" label={t('wallet:home.actions.details', 'Kontodetails')} onClick={() => onAction?.('balance')} />
        </div>
      </section>

      {/* Assets */}
      {summary && (
        <section className={`${cardCls} mt-4 overflow-hidden`} data-testid="wallet-home-assets">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('wallet:home.assets', 'Assets')}
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {summary.assets.length + 1}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => onAction?.('listAll')}
              className="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-gray-700 dark:hover:text-blue-200"
            >
              {t('wallet:home.manageTrustlines', 'Token-Freigaben verwalten')}
            </button>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/70">
            <li className="flex items-center gap-3 px-5 py-3">
              <AssetAvatar label="XLM" native />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">XLM</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Stellar Lumens</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{fmt(summary.xlm, { min: 2, max: 7 })}</div>
                {fiat(summary.xlm) && (
                  <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400">≈ {fiat(summary.xlm)}</div>
                )}
              </div>
            </li>
            {summary.assets.map((asset) => (
              <li key={asset.key} className="flex items-center gap-3 px-5 py-3">
                <AssetAvatar label={asset.isPool ? 'LP' : asset.code} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {asset.isPool ? t('wallet:home.poolShares', 'Liquiditätspool-Anteile') : asset.code}
                  </div>
                  <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={asset.issuer}>
                    {asset.isPool
                      ? `${t('wallet:home.pool', 'Pool')} ${shortenAddress(asset.issuer, 6, 6)}`
                      : `${t('wallet:home.issuer', 'Herausgeber')} ${shortenAddress(asset.issuer)}`}
                  </div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                  {fmt(asset.balance, { min: 0, max: 7 })}
                </div>
              </li>
            ))}
          </ul>
          {summary.assets.length === 0 && (
            <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
              {t('wallet:home.noTrustlines', 'Noch keine Token-Freigaben. Um andere Token zu halten, brauchst du zuerst eine Freigabe (Trustline).')}
            </p>
          )}
          <p className="border-t border-gray-100 bg-gray-50 px-5 py-2.5 text-xs text-gray-500 dark:border-gray-700/70 dark:bg-gray-900/40 dark:text-gray-400">
            {t('wallet:home.tokenNote', 'Ein Gegenwert wird nur für XLM angezeigt. SKM bewertet keine Token und trifft keine Aussage darüber, ob ein Token echt ist.')}
          </p>
        </section>
      )}
    </div>
  );
}
