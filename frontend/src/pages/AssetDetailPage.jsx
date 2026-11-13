import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TokenFactsSummary from '../components/trading/TokenFactsSummary.jsx';
import useAssetFacts from '../components/trading/hooks/useAssetFacts.js';
import { getHorizonServerForNetwork } from '../utils/stellar/stellarUtils.js';
import { parseAssetDetailPath } from '../utils/assetDetailRoute.js';
import { looksLikeNativeCode } from '../utils/stellar/activity.js';
import { FakeNativeBadge } from '../components/wallet/ActivityWarnings.jsx';

/**
 * Asset-Detailseite (/assets/CODE-ISSUER), verlinkbar.
 * Zeigt das Asset im geladenen Konto (Saldo, Limit, gebundene Betraege, Autorisierung) und die
 * Fakten zum Issuer (gleiche TokenFactsSummary wie Trading und Liquidity). Nur Anzeige und Links:
 * Handeln oeffnet Token suchen und handeln mit vorbelegtem Asset, gesendet wird hier nichts.
 */

function readAssetFromUrl() {
  return parseAssetDetailPath(typeof window !== 'undefined' ? window.location.pathname : '');
}

function useAssetFromUrl() {
  const [asset, setAsset] = useState(readAssetFromUrl);
  useEffect(() => {
    const apply = () => setAsset(readAssetFromUrl());
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, []);
  return asset;
}

const EMPTY_ACCOUNT = { loading: false, error: '', notFound: false, account: null };

function useAccount(publicKey, network) {
  const [state, setState] = useState(EMPTY_ACCOUNT);
  useEffect(() => {
    if (!publicKey) { setState(EMPTY_ACCOUNT); return undefined; }
    let cancelled = false;
    setState({ ...EMPTY_ACCOUNT, loading: true });
    getHorizonServerForNetwork(network)
      .loadAccount(publicKey)
      .then((account) => { if (!cancelled) setState({ ...EMPTY_ACCOUNT, account }); })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status || err?.status;
        setState({ ...EMPTY_ACCOUNT, notFound: status === 404, error: status === 404 ? '' : 'load' });
      });
    return () => { cancelled = true; };
  }, [publicKey, network]);
  return state;
}

/** Saldo-Eintrag des Assets im Konto (nur echte Asset-Trustlines, keine Pool Shares). */
function findAssetBalance(account, code, issuer) {
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  return balances.find((b) =>
    (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
    b.asset_code === code && b.asset_issuer === issuer
  ) || null;
}

function Row({ label, children, testId }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-sm text-gray-900 dark:text-gray-100" data-testid={testId}>{children}</dd>
    </div>
  );
}

const cardCls = 'rounded-xl border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-800';
const linkBtnCls = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700';

export default function AssetDetailPage({ publicKey = '', network = 'PUBLIC', onBack, onTrade, onManageTrustlines }) {
  const { t, i18n } = useTranslation(['wallet', 'trading', 'common']);
  const asset = useAssetFromUrl();
  const valid = !!asset && !asset.invalid;
  const code = valid ? asset.code : '';
  const issuer = valid ? asset.issuer : '';
  const accountState = useAccount(valid ? publicKey : '', network);
  const [copied, setCopied] = useState(false);

  // useAssetFacts braucht ein stabiles Objekt, sonst laedt es bei jedem Render neu
  const factsAsset = useMemo(() => (valid ? { assetCode: code, assetIssuer: issuer } : null), [valid, code, issuer]);
  const { assetFacts } = useAssetFacts({ selectedAsset: factsAsset, network, targetStellarAsset: null, swapDirection: '' });

  const fmt = useMemo(() => {
    const nf = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 0, maximumFractionDigits: 7 });
    return (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? nf.format(n) : '–';
    };
  }, [i18n.language]);

  if (!valid) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-10" data-testid="asset-detail-invalid">
        <h1 className="text-2xl font-bold">{t('wallet:assetDetail.title', 'Asset-Details')}</h1>
        <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {t('wallet:assetDetail.invalid', 'Dieser Link enthält kein gültiges Asset (erwartet: CODE-ISSUER).')}
        </p>
        {onBack && <button type="button" className={`${linkBtnCls} mt-4`} onClick={onBack}>{t('wallet:assetDetail.back', 'Zurück zur Wallet')}</button>}
      </div>
    );
  }

  const balance = findAssetBalance(accountState.account, code, issuer);
  const available = balance ? Math.max(0, Number(balance.balance) - Number(balance.selling_liabilities || 0)) : null;
  const netLabel = network === 'TESTNET' ? 'Testnet' : 'Mainnet';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(issuer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  let accountBody;
  if (!publicKey) {
    accountBody = <p className="text-sm text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.account.noAccount', 'Kein Konto geladen. Lade oben ein Konto, um deinen Bestand zu sehen.')}</p>;
  } else if (accountState.loading) {
    accountBody = <p className="text-sm text-gray-600 dark:text-gray-300" aria-busy="true">{t('wallet:assetDetail.account.loading', 'Konto wird geladen …')}</p>;
  } else if (accountState.notFound) {
    accountBody = <p className="text-sm text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.account.notFound', 'Dieses Konto existiert in diesem Netz noch nicht.')}</p>;
  } else if (accountState.error) {
    accountBody = <p className="text-sm text-red-700 dark:text-red-400" role="alert">{t('wallet:assetDetail.account.loadError', 'Kontodaten konnten nicht geladen werden.')}</p>;
  } else if (!balance) {
    accountBody = <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="asset-detail-no-trustline">{t('wallet:assetDetail.account.noTrustline', 'Dein Konto hat keine Trustline für dieses Asset.')}</p>;
  } else {
    accountBody = (
      <dl className="grid gap-3 sm:grid-cols-2" data-testid="asset-detail-balance">
        <Row label={t('wallet:assetDetail.account.balance', 'Saldo')} testId="asset-detail-balance-value">{fmt(balance.balance)} {code}</Row>
        <Row label={t('wallet:assetDetail.account.available', 'Verfügbar (Saldo minus Verkaufsaufträge)')}>{fmt(available)} {code}</Row>
        <Row label={t('wallet:assetDetail.account.sellingLiabilities', 'In Verkaufsaufträgen gebunden')}>{fmt(balance.selling_liabilities)} {code}</Row>
        <Row label={t('wallet:assetDetail.account.buyingLiabilities', 'In Kaufaufträgen reserviert')}>{fmt(balance.buying_liabilities)} {code}</Row>
        <Row label={t('wallet:assetDetail.account.limit', 'Trustline-Limit')}>{fmt(balance.limit)}</Row>
        <Row label={t('wallet:assetDetail.account.authorized', 'Vom Issuer autorisiert')}>
          {balance.is_authorized === false
            ? t('wallet:assetDetail.account.no', 'Nein')
            : t('wallet:assetDetail.account.yes', 'Ja')}
        </Row>
      </dl>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pb-10 text-left" data-testid="asset-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('wallet:assetDetail.title', 'Asset-Details')} · {netLabel}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white" data-testid="asset-detail-code">{code}</h1>
          {looksLikeNativeCode({ code, isNative: false }) && <div className="mt-1"><FakeNativeBadge /></div>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-xs text-gray-600 dark:text-gray-300" data-testid="asset-detail-issuer">{issuer}</span>
            <button type="button" onClick={handleCopy} className="rounded-sm border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600">
              {copied ? t('wallet:assetDetail.copied', 'Kopiert') : t('wallet:assetDetail.copyIssuer', 'Issuer kopieren')}
            </button>
          </div>
        </div>
        {onBack && (
          <button type="button" className={linkBtnCls} onClick={onBack}>{t('wallet:assetDetail.back', 'Zurück zur Wallet')}</button>
        )}
      </div>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.account.title', 'In deinem Konto')}</h2>
        {accountBody}
        <div className="mt-4 flex flex-wrap gap-2">
          {onTrade && (
            <button type="button" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => onTrade({ code, issuer })} data-testid="asset-detail-trade">
              {t('wallet:assetDetail.trade', 'Handeln (kaufen oder verkaufen)')}
            </button>
          )}
          {onManageTrustlines && publicKey && (
            <button type="button" className={linkBtnCls} onClick={onManageTrustlines}>{t('wallet:assetDetail.manageTrustlines', 'Trustlines verwalten')}</button>
          )}
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.facts', 'Fakten zum Asset')}</h2>
        <TokenFactsSummary facts={assetFacts} asset={factsAsset} includeDisclaimer includeRoute={false} />
      </section>
    </div>
  );
}
