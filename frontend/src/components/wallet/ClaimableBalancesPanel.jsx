import React from 'react';
import { getNetworkConfig, horizonUrlFor, passphraseFor } from '../../config/networks.js';
import { useTranslation } from 'react-i18next';

import SecretKeyModal from '../SecretKeyModal.jsx';
import MultisigPrepareDialog from '../MultisigPrepareDialog.jsx';
import BatchConvertDialog from './BatchConvertDialog.jsx';
import { createMultisigJobFromXdr } from '../../utils/multisigApi.js';
import { assetLabel } from '../../utils/stellar/batchConvert.js';
import { isMultisigAccount } from '../../utils/stellar/isMultisigAccount.js';
import { useSettings } from '../../utils/useSettings.js';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { shortenAddress } from '../../utils/stellar/walletSummary.js';
import { isDustAmount, looksLikeNativeCode } from '../../utils/stellar/activity.js';
import { DustBadge, FakeNativeBadge } from './ActivityWarnings.jsx';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { getSessionSecrets, rememberSessionSecrets, InsecureCryptoContextError } from '../../utils/sessionSecrets.js';
import { assertHorizonNetwork, collectEffectiveSigners } from '../../utils/multisig/jobRevocation.js';
import {
  buildClaimTx,
  claimJobTimeoutSeconds,
  classifyClaimableBalances,
  fetchClaimableBalances,
  getHiddenClaimableIds,
  setHiddenClaimableIds,
} from '../../utils/stellar/claimableBalances.js';
import { txHashHex } from '../../utils/stellar/txHash.js';

const TRUSTLINE_RESERVE_XLM = 0.5;

const cardCls = 'rounded-2xl border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800/70';
const linkBtnCls =
  'rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-800 ' +
  'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-gray-700 dark:hover:text-blue-200';

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
  const horizonUrl = horizonUrlFor(network);
  const networkPassphrase = passphraseFor(network);

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
  const [preparedJob, setPreparedJob] = React.useState(null);
  const [showBatch, setShowBatch] = React.useState(false);
  const { multisigTimeoutSeconds } = useSettings();
  const multisig = isMultisigAccount(account);

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
  // Batch-Convert lohnt sich erst ab mehreren Eintraegen; ausgeblendete zaehlen mit,
  // gerade unerwuenschte Token sollen sich so in ein gewaehltes Asset umwandeln lassen.
  const batchItems = items
    .filter((it) => it.claimableNow && !it.isIssuer)
    .map((it) => ({ ...it, hidden: hiddenIds.includes(it.id) }));

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

  const reserveOk = (item) => {
    if (!needsTrustline(item) || Number(available || 0) >= TRUSTLINE_RESERVE_XLM) return true;
    setClaimError(t('wallet:claimable.insufficientReserve', {
      reserve: TRUSTLINE_RESERVE_XLM,
      available: fmt ? fmt(Number(available || 0), { min: 2, max: 7 }) : String(available || 0),
    }));
    return false;
  };

  const startClaim = (item) => {
    setInfo('');
    setClaimError('');
    if (!item.claimableNow || item.blockedReason || !reserveOk(item)) return;
    setClaimItem(item);
  };

  // Multisig: unsignierte Transaktion als Job anlegen, die anderen Signer signieren auf der Webseite.
  const prepareJob = async (item) => {
    if (inFlightRef.current) return;
    setInfo('');
    setClaimError('');
    if (!item.claimableNow || item.blockedReason || !reserveOk(item)) return;
    const timeoutSeconds = claimJobTimeoutSeconds(item, multisigTimeoutSeconds);
    if (timeoutSeconds == null) {
      setClaimError(t('wallet:claimable.tooLittleTime'));
      return;
    }
    inFlightRef.current = true;
    try {
      setClaiming(true);
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      const fresh = await server.loadAccount(publicKey);
      const [current] = classifyClaimableBalances(records.filter((r) => r.id === item.id), fresh);
      if (!current || !current.claimableNow || current.blockedReason) {
        setClaimError(t(current?.blockedReason ? `wallet:claimable.blocked.${current.blockedReason}` : 'wallet:claimable.notClaimable'));
        return;
      }
      // Wird erst spaeter eingereicht: Gebuehrenstufe Schnell (siehe fees.js)
      const fee = await resolveFeePerOp(server, { deferred: true });
      const tx = buildClaimTx({ account: fresh, item: current, fee, networkPassphrase, timeoutSeconds });
      const job = await createMultisigJobFromXdr({
        network: getNetworkConfig(network).backendId,
        accountId: publicKey,
        txXdr: tx.toXDR(),
      });
      setPreparedJob({
        hash: job.hash || txHashHex(tx),
        xdr: job.xdr,
        summary: {
          title: t('multisig:prepare.title'),
          subtitle: t('multisig:prepare.subtitle'),
          items: [
            { label: t('wallet:claimable.jobSource'), value: publicKey },
            { label: t('wallet:claimable.jobClaim'), value: `${current.amount} ${assetLabel(current.asset, shortenAddress)}` },
            needsTrustline(current) ? { label: t('wallet:claimable.jobTrustline'), value: assetLabel(current.asset, shortenAddress) } : null,
            { label: t('wallet:claimable.jobNetwork'), value: isTestnet ? 'Testnet' : 'Mainnet' },
            { label: t('multisig:detail.idLabel', 'Job-ID'), value: job.id },
            { label: t('wallet:claimable.jobNoteLabel'), value: t('wallet:claimable.jobHint') },
          ].filter(Boolean),
        },
      });
    } catch (e) {
      console.error('[SKM] claimable balance job creation failed', e);
      setClaimError(describeError(e));
    } finally {
      inFlightRef.current = false;
      setClaiming(false);
    }
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
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      // Frisch laden: Signer, Thresholds und Trustlines koennen sich geaendert haben.
      const fresh = await server.loadAccount(publicKey);
      const [item] = classifyClaimableBalances(
        records.filter((r) => r.id === claimItem.id),
        fresh
      );
      if (!item || !item.claimableNow || item.blockedReason) {
        setClaimError(t(item?.blockedReason ? `wallet:claimable.blocked.${item.blockedReason}` : 'wallet:claimable.notClaimable'));
        return;
      }
      const withTrustline = needsTrustline(item);
      const required = Math.max(
        getRequiredThreshold('claimClaimableBalance', fresh?.thresholds),
        withTrustline ? getRequiredThreshold('changeTrust', fresh?.thresholds) : 0
      );
      const { signers, weight } = collectEffectiveSigners(collected, fresh?.signers);
      if (!signers.length || weight < required) {
        setClaimError(t(multisig ? 'wallet:claimable.insufficientWeightJob' : 'wallet:claimable.insufficientWeight', { required }));
        return;
      }
      const fee = await resolveFeePerOp(server);
      const tx = buildClaimTx({ account: fresh, item, fee, networkPassphrase });
      signers.forEach((s) => tx.sign(s.keypair));
      const res = await submitTransactionSafely(server, tx);
      const hash = res?.hash || res?.id || txHashHex(tx);
      setClaimItem(null);
      setInfo(t('wallet:claimable.success', { amount: item.amount, code: item.asset.code, hash }));
      // Erst nach erfolgreicher Signatur und Einreichung merken
      if (remember) {
        try {
          await rememberSessionSecrets(publicKey, collected);
        } catch (rememberErr) {
          if (rememberErr instanceof InsecureCryptoContextError) setClaimError(t('secretKey:remember.insecureContextError'));
        }
      }
      onClaimed?.();
    } catch (e) {
      console.error('[SKM] claim claimable balance failed', e);
      setClaimError(describeError(e));
      // Ergebnis unklar: kein sofortiges zweites Senden. Dialog schliessen und neu laden,
      // dann zeigt die Liste, ob die Claimable Balance noch da ist.
      if (e instanceof AmbiguousSubmitResultError) {
        setClaimItem(null);
        onClaimed?.();
      }
    } finally {
      inFlightRef.current = false;
      setClaiming(false);
    }
  };

  if (!publicKey) return null;

  const renderItem = (item) => {
    const hidden = hiddenIds.includes(item.id);
    return (
      <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="claimable-item" data-claimable-id={item.id}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-gray-900 dark:text-white">
            <span className="tabular-nums">{fmt ? fmt(Number(item.amount), { min: 0, max: 7 }) : item.amount}</span>
            <span className="truncate">{item.asset.code}</span>
            {!item.asset.isNative && looksLikeNativeCode({ code: item.asset.code, isNative: false }) && <FakeNativeBadge />}
            {isDustAmount(item.asset, item.amount) && <DustBadge />}
          </div>
          <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {!item.asset.isNative && (
              <span title={item.asset.issuer}>{t('wallet:claimable.issuer', { issuer: shortenAddress(item.asset.issuer) })} · </span>
            )}
            {item.sponsor && <span title={item.sponsor}>{t('wallet:claimable.from', { account: shortenAddress(item.sponsor) })}</span>}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {!item.claimableNow && <span className="font-medium text-gray-700 dark:text-gray-300">{t('wallet:claimable.notClaimable')} </span>}
            {item.claimableNow && item.blockedReason && <span className="font-medium text-gray-700 dark:text-gray-300">{t(`wallet:claimable.blocked.${item.blockedReason}`)} </span>}
            {item.window?.until && t('wallet:claimable.until', { date: formatDate(item.window.until) })}
            {item.window?.from && t('wallet:claimable.fromDate', { date: formatDate(item.window.from) })}
            {needsTrustline(item) && <span> {t('wallet:claimable.withTrustline', { code: item.asset.code })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={linkBtnCls} onClick={() => toggleHidden(item.id)}>
            {hidden ? t('wallet:claimable.unhide') : t('wallet:claimable.hide')}
          </button>
          {multisig && (
            <button
              type="button"
              onClick={() => { void prepareJob(item); }}
              disabled={!item.claimableNow || !!item.blockedReason || claiming}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-200"
            >
              {t('wallet:claimable.prepareJob')}
            </button>
          )}
          <button
            type="button"
            onClick={() => startClaim(item)}
            disabled={!item.claimableNow || !!item.blockedReason || claiming}
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
        <div className="flex items-center gap-1">
          {hiddenCount > 0 && (
            <button type="button" className={linkBtnCls} onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? t('wallet:claimable.hideHidden') : t('wallet:claimable.showHidden', { count: hiddenCount })}
            </button>
          )}
          {batchItems.length >= 2 && (
            <button
              type="button"
              onClick={() => { setInfo(''); setClaimError(''); setShowBatch(true); }}
              className="rounded-lg border-0 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              {t('wallet:batchConvert.button', { count: batchItems.length })}
            </button>
          )}
        </div>
      </div>
      <p className="px-5 pt-3 text-xs text-gray-600 dark:text-gray-300">{t('wallet:claimable.intro')}</p>
      {items.length > 0 && (
        <p className="px-5 pt-1 text-xs text-gray-600 dark:text-gray-300" data-testid="claimable-unsolicited">
          {t('wallet:claimable.unsolicitedNote')}
        </p>
      )}
      {info && <p role="status" className="px-5 pt-2 text-xs text-green-700 dark:text-green-400 break-all">{info}</p>}
      {claimError && !claimItem && <p role="alert" className="px-5 pt-2 text-xs text-red-700 dark:text-red-300">{claimError}</p>}
      {loadError && <p className="px-5 pt-2 text-xs text-red-700 dark:text-red-300">{loadError}</p>}

      {items.length === 0 && !loadError && (
        <p className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400" data-testid="claimable-empty">{t('wallet:claimable.empty')}</p>
      )}

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
      {items.length > 0 && (
        <p className="mt-2 border-t border-gray-100 bg-gray-50 px-5 py-2.5 text-xs text-gray-500 dark:border-gray-700/70 dark:bg-gray-900/40 dark:text-gray-400">
          {t('wallet:home.tokenNote')}
        </p>
      )}

      {showBatch && (
        <BatchConvertDialog
          publicKey={publicKey}
          account={account}
          network={network}
          available={available}
          items={batchItems}
          multisig={multisig}
          multisigTimeoutSeconds={multisigTimeoutSeconds}
          fmt={fmt}
          onClose={() => setShowBatch(false)}
          onDone={() => onClaimed?.()}
        />
      )}

      {preparedJob && (
        <MultisigPrepareDialog
          open={!!preparedJob}
          onClose={() => setPreparedJob(null)}
          hash={preparedJob.hash}
          xdr={preparedJob.xdr}
          summary={preparedJob.summary}
        />
      )}

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
