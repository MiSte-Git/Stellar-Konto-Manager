import React from 'react';
import { useTranslation } from 'react-i18next';
import { Networks } from '@stellar/stellar-sdk';

import SecretKeyModal from '../SecretKeyModal.jsx';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { shortenAddress } from '../../utils/stellar/walletSummary.js';
import { looksLikeNativeCode } from '../../utils/stellar/activity.js';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { getSessionSecrets, rememberSessionSecrets, InsecureCryptoContextError } from '../../utils/sessionSecrets.js';
import { assertHorizonNetwork, collectEffectiveSigners } from '../../utils/multisig/jobRevocation.js';
import {
  buildClaimTx,
  classifyClaimableBalances,
  fetchClaimableBalances,
  getHiddenClaimableIds,
  setHiddenClaimableIds,
} from '../../utils/stellar/claimableBalances.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';
const TRUSTLINE_RESERVE_XLM = 0.5;

const cardCls = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/70';
const linkBtnCls =
  'rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-800 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-gray-700 dark:hover:text-blue-200';

function needsTrustline(item) {
  return !item.asset.isNative && !item.hasTrustline && !item.isIssuer;
}

/**
 * Claimable Balances des geladenen Kontos: anzeigen, ausblenden, einloesen.
 * @param {{ publicKey: string, account: object, network: 'PUBLIC'|'TESTNET', available: number, fmt: Function, locale?: string, reloadToken?: number, onClaimed?: () => void }} props
 */
export default function ClaimableBalancesPanel({ publicKey, account, network, available, fmt, locale, reloadToken = 0, onClaimed }) {
  const { t } = useTranslation(['wallet', 'common', 'secretKey']);
  const isTestnet = network === 'TESTNET';
  const horizonUrl = isTestnet ? HORIZON_TEST : HORIZON_MAIN;
  const networkPassphrase = isTestnet ? Networks.TESTNET : Networks.PUBLIC;

  const [records, setRecords] = React.useState([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [hiddenIds, setHiddenIds] = React.useState(() => getHiddenClaimableIds(network, publicKey));
  const [showHidden, setShowHidden] = React.useState(false);
  const [showNoTrust, setShowNoTrust] = React.useState(false);
  const [claimItem, setClaimItem] = React.useState(null);
  const [prefill, setPrefill] = React.useState([]);
  const [claiming, setClaiming] = React.useState(false);
  const [claimError, setClaimError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    setHiddenIds(getHiddenClaimableIds(network, publicKey));
  }, [network, publicKey]);

  React.useEffect(() => {
    if (!publicKey) return undefined;
    let cancelled = false;
    setLoadError('');
    fetchClaimableBalances(getHorizonServer(horizonUrl), publicKey)
      .then(({ records: recs, truncated: trunc }) => {
        if (cancelled) return;
        setRecords(recs);
        setTruncated(trunc);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[SKM] claimable balances could not be loaded', err);
        setRecords([]);
        setLoadError(t('wallet:claimable.loadError'));
      });
    return () => { cancelled = true; };
  }, [publicKey, horizonUrl, reloadToken, t]);

  // Session-Secrets wie beim Senden vorbelegen
  React.useEffect(() => {
    if (!claimItem || !publicKey) {
      setPrefill([]);
      return undefined;
    }
    let cancelled = false;
    getSessionSecrets(publicKey).then((map) => { if (!cancelled) setPrefill(Object.values(map)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [claimItem, publicKey]);

  const items = React.useMemo(() => classifyClaimableBalances(records, account), [records, account]);
  const visible = items.filter((it) => showHidden || !hiddenIds.includes(it.id));
  const known = visible.filter((it) => !needsTrustline(it));
  const noTrust = visible.filter((it) => needsTrustline(it));
  const hiddenCount = items.filter((it) => hiddenIds.includes(it.id)).length;

  const toggleHidden = (id) => {
    const next = hiddenIds.includes(id) ? hiddenIds.filter((v) => v !== id) : [...hiddenIds, id];
    setHiddenIds(next);
    setHiddenClaimableIds(network, publicKey, next);
  };

  const formatDate = (sec) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sec * 1000));
    } catch {
      return new Date(sec * 1000).toISOString();
    }
  };

  const startClaim = (item) => {
    setInfo('');
    setClaimError('');
    if (!item.claimableNow) return;
    if (needsTrustline(item) && Number(available || 0) < TRUSTLINE_RESERVE_XLM) {
      setClaimError(t('wallet:claimable.insufficientReserve', {
        reserve: TRUSTLINE_RESERVE_XLM,
        available: fmt ? fmt(Number(available || 0), { min: 2, max: 7 }) : String(available || 0),
      }));
      return;
    }
    setClaimItem(item);
  };

  const describeError = (e) => {
    if (e instanceof AmbiguousSubmitResultError) return t('wallet:claimable.ambiguous', { hash: e.hash });
    if (e?.code === 'network_mismatch') return t('wallet:claimable.networkMismatch');
    const codes = e?.response?.data?.extras?.result_codes;
    if (codes) return t('wallet:claimable.failed', { reason: JSON.stringify(codes) });
    return t('wallet:claimable.failed', { reason: formatErrorForUi(t, e) });
  };

  const executeClaim = async (collected, remember) => {
    if (!claimItem || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setClaiming(true);
      setClaimError('');
      if (remember) {
        try {
          await rememberSessionSecrets(publicKey, collected);
        } catch (rememberErr) {
          if (rememberErr instanceof InsecureCryptoContextError) setClaimError(t('secretKey:remember.insecureContextError'));
        }
      }
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      // Frisch laden: Signer, Thresholds und Trustlines koennen sich geaendert haben.
      const fresh = await server.loadAccount(publicKey);
      const [item] = classifyClaimableBalances(
        records.filter((r) => r.id === claimItem.id),
        fresh
      );
      if (!item || !item.claimableNow) {
        setClaimError(t('wallet:claimable.notClaimable'));
        return;
      }
      const withTrustline = needsTrustline(item);
      const required = Math.max(
        getRequiredThreshold('claimClaimableBalance', fresh?.thresholds),
        withTrustline ? getRequiredThreshold('changeTrust', fresh?.thresholds) : 0
      );
      const { signers, weight } = collectEffectiveSigners(collected, fresh?.signers);
      if (!signers.length || weight < required) {
        setClaimError(t('wallet:claimable.insufficientWeight', { required }));
        return;
      }
      const fee = await resolveFeePerOp(server);
      const tx = buildClaimTx({ account: fresh, item, fee, networkPassphrase });
      signers.forEach((s) => tx.sign(s.keypair));
      const res = await submitTransactionSafely(server, tx);
      const hash = res?.hash || res?.id || tx.hash().toString('hex');
      setClaimItem(null);
      setInfo(t('wallet:claimable.success', { amount: item.amount, code: item.asset.code, hash }));
      onClaimed?.();
    } catch (e) {
      console.error('[SKM] claim claimable balance failed', e);
      setClaimError(describeError(e));
    } finally {
      inFlightRef.current = false;
      setClaiming(false);
    }
  };

  if (!publicKey || (items.length === 0 && !loadError && !info)) return null;

  const renderItem = (item) => {
    const hidden = hiddenIds.includes(item.id);
    return (
      <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="claimable-item" data-claimable-id={item.id}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-gray-900 dark:text-white">
            <span className="tabular-nums">{fmt ? fmt(Number(item.amount), { min: 0, max: 7 }) : item.amount}</span>
            <span className="truncate">{item.asset.code}</span>
            {!item.asset.isNative && looksLikeNativeCode({ code: item.asset.code, isNative: false }) && (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200"
                title={t('wallet:activity.fakeNativeHint', 'Das ist ein Token eines Herausgebers, nicht das native XLM des Netzwerks.')}
              >
                {t('wallet:activity.fakeNative', 'Token, kein natives XLM')}
              </span>
            )}
          </div>
          <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {!item.asset.isNative && (
              <span title={item.asset.issuer}>{t('wallet:claimable.issuer', { issuer: shortenAddress(item.asset.issuer) })} · </span>
            )}
            {item.sponsor && <span title={item.sponsor}>{t('wallet:claimable.from', { account: shortenAddress(item.sponsor) })}</span>}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {!item.claimableNow && <span className="font-medium text-gray-700 dark:text-gray-300">{t('wallet:claimable.notClaimable')} </span>}
            {item.window?.until && t('wallet:claimable.until', { date: formatDate(item.window.until) })}
            {item.window?.from && t('wallet:claimable.fromDate', { date: formatDate(item.window.from) })}
            {needsTrustline(item) && <span> {t('wallet:claimable.withTrustline', { code: item.asset.code })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={linkBtnCls} onClick={() => toggleHidden(item.id)}>
            {hidden ? t('wallet:claimable.unhide') : t('wallet:claimable.hide')}
          </button>
          <button
            type="button"
            onClick={() => startClaim(item)}
            disabled={!item.claimableNow || claiming}
            className="rounded-lg border-0 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('wallet:claimable.claim')}
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className={`${cardCls} mt-4 overflow-hidden`} data-testid="wallet-home-claimable">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('wallet:claimable.title')}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {items.length}
          </span>
        </h2>
        {hiddenCount > 0 && (
          <button type="button" className={linkBtnCls} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? t('wallet:claimable.hideHidden') : t('wallet:claimable.showHidden', { count: hiddenCount })}
          </button>
        )}
      </div>
      <p className="px-5 pt-3 text-xs text-gray-600 dark:text-gray-300">{t('wallet:claimable.intro')}</p>
      {info && <p role="status" className="px-5 pt-2 text-xs text-green-700 dark:text-green-400 break-all">{info}</p>}
      {claimError && !claimItem && <p role="alert" className="px-5 pt-2 text-xs text-red-700 dark:text-red-300">{claimError}</p>}
      {loadError && <p className="px-5 pt-2 text-xs text-red-700 dark:text-red-300">{loadError}</p>}

      {known.length > 0 && <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700/70">{known.map(renderItem)}</ul>}

      {noTrust.length > 0 && (
        <div className="mt-2 border-t border-gray-100 dark:border-gray-700/70">
          <div className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('wallet:claimable.noTrustTitle', { count: noTrust.length })}</span>
            <button type="button" className={linkBtnCls} aria-expanded={showNoTrust} onClick={() => setShowNoTrust((v) => !v)}>
              {showNoTrust ? t('wallet:claimable.noTrustHide') : t('wallet:claimable.noTrustShow')}
            </button>
          </div>
          {showNoTrust && (
            <>
              <p className="px-5 pb-2 text-xs text-gray-600 dark:text-gray-300">{t('wallet:claimable.noTrustNote')}</p>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700/70">{noTrust.map(renderItem)}</ul>
            </>
          )}
        </div>
      )}

      {truncated && <p className="px-5 py-2 text-xs text-gray-500 dark:text-gray-400">{t('wallet:claimable.truncated', { count: records.length })}</p>}
      <p className="mt-2 border-t border-gray-100 bg-gray-50 px-5 py-2.5 text-xs text-gray-500 dark:border-gray-700/70 dark:bg-gray-900/40 dark:text-gray-400">
        {t('wallet:home.tokenNote')}
      </p>

      {claimItem && (
        <SecretKeyModal
          onConfirm={(collected, remember) => { void executeClaim(collected, remember); }}
          onCancel={() => { setClaimItem(null); setClaimError(''); }}
          errorMessage={claimError}
          thresholds={account?.thresholds}
          signers={account?.signers || []}
          operationType={needsTrustline(claimItem) ? 'changeTrust' : 'claimClaimableBalance'}
          requiredThreshold={Math.max(
            getRequiredThreshold('claimClaimableBalance', account?.thresholds),
            needsTrustline(claimItem) ? getRequiredThreshold('changeTrust', account?.thresholds) : 0
          )}
          isProcessing={claiming}
          account={account}
          initialSecretValues={prefill}
        />
      )}
    </section>
  );
}
