import React from 'react';
import { useTranslation } from 'react-i18next';
import { Networks } from '@stellar/stellar-sdk';

import SecretKeyModal from '../SecretKeyModal.jsx';
import MultisigPrepareDialog from '../MultisigPrepareDialog.jsx';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import { shortenAddress } from '../../utils/stellar/walletSummary.js';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { getSessionSecrets, rememberSessionSecrets, InsecureCryptoContextError } from '../../utils/sessionSecrets.js';
import { assertHorizonNetwork, collectEffectiveSigners } from '../../utils/multisig/jobRevocation.js';
import { createMultisigJobFromXdr } from '../../utils/multisigApi.js';
import { claimJobTimeoutSeconds } from '../../utils/stellar/claimableBalances.js';
import {
  DEFAULT_BATCH_SLIPPAGE,
  NATIVE_TARGET,
  buildBatchTx,
  chunkQuotes,
  countOps,
  parseTargetAsset,
  quoteItems,
  targetTrustlineStatus,
} from '../../utils/stellar/batchConvert.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';
const BASE_RESERVE_XLM = 0.5;
const STROOPS_PER_XLM = 10000000;
const CUSTOM = '__custom__';

const btnPrimary = 'rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const btnSecondary = 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

/**
 * Batch-Convert: mehrere Claimable Balances einloesen und in ein Ziel-Asset umwandeln.
 * @param {{ publicKey: string, account: object, network: 'PUBLIC'|'TESTNET', available: number, items: object[], multisig: boolean, multisigTimeoutSeconds: number, fmt?: Function, onClose: () => void, onDone?: () => void }} props
 */
export default function BatchConvertDialog({ publicKey, account, network, available, items, multisig, multisigTimeoutSeconds, fmt, onClose, onDone }) {
  const { t } = useTranslation(['wallet', 'common', 'multisig', 'secretKey']);
  const isTestnet = network === 'TESTNET';
  const horizonUrl = isTestnet ? HORIZON_TEST : HORIZON_MAIN;
  const networkPassphrase = isTestnet ? Networks.TESTNET : Networks.PUBLIC;
  const f = (v) => (fmt ? fmt(Number(v || 0), { min: 0, max: 7 }) : String(v));

  const trustlineTargets = React.useMemo(
    () => (account?.balances || [])
      .filter((b) => b.asset_type !== 'native' && b.asset_code && b.is_authorized !== false)
      .map((b) => ({ isNative: false, code: b.asset_code, issuer: b.asset_issuer, key: `${b.asset_code}:${b.asset_issuer}` })),
    [account]
  );

  const [targetChoice, setTargetChoice] = React.useState('XLM');
  const [customTarget, setCustomTarget] = React.useState('');
  const [slippage, setSlippage] = React.useState(DEFAULT_BATCH_SLIPPAGE);
  const [phase, setPhase] = React.useState('setup'); // setup | quoting | preview | running | done
  const [quotes, setQuotes] = React.useState([]);
  const [selected, setSelected] = React.useState(() => new Set());
  const [quotedTarget, setQuotedTarget] = React.useState(null);
  const [fee, setFee] = React.useState('100');
  const [error, setError] = React.useState('');
  const [progress, setProgress] = React.useState(null);
  const [results, setResults] = React.useState([]);
  const [showSecretModal, setShowSecretModal] = React.useState(false);
  const [prefill, setPrefill] = React.useState([]);
  const [preparedJob, setPreparedJob] = React.useState(null);
  const inFlightRef = React.useRef(false);

  const target = targetChoice === CUSTOM
    ? parseTargetAsset(customTarget)
    : (targetChoice === 'XLM' ? NATIVE_TARGET : trustlineTargets.find((a) => a.key === targetChoice) || null);

  React.useEffect(() => {
    if (!showSecretModal) return undefined;
    let cancelled = false;
    getSessionSecrets(publicKey).then((map) => { if (!cancelled) setPrefill(Object.values(map)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [showSecretModal, publicKey]);

  const selectedQuotes = quotes.filter((q) => q.status === 'ok' && selected.has(q.item.id));
  const targetStatus = quotedTarget ? targetTrustlineStatus(account, quotedTarget) : 'native';
  const needTargetTrustline = targetStatus === 'missing';
  const chunks = chunkQuotes(selectedQuotes, { needTargetTrustline });
  const totalOps = chunks.reduce((acc, c, i) => acc + countOps(c, needTargetTrustline && i === 0), 0);
  const feeTotalXlm = (Number(fee) * totalOps) / STROOPS_PER_XLM;
  const expectedTotal = selectedQuotes.reduce((acc, q) => acc + Number(q.destAmount || 0), 0);
  const minTotal = selectedQuotes.reduce((acc, q) => acc + Number(q.destMin || 0), 0);
  const anyTempTrustline = selectedQuotes.some((q) => q.plan.tempTrustline);
  const reserveNeeded = (anyTempTrustline ? BASE_RESERVE_XLM : 0) + (needTargetTrustline ? BASE_RESERVE_XLM : 0) + feeTotalXlm;
  const reserveOk = Number(available || 0) >= reserveNeeded;

  const loadPreview = async () => {
    setError('');
    if (!target) {
      setError(t('wallet:batchConvert.invalidTarget'));
      return;
    }
    const slip = Number(String(slippage).replace(',', '.'));
    if (!Number.isFinite(slip) || slip < 0 || slip > 50) {
      setError(t('wallet:batchConvert.invalidSlippage'));
      return;
    }
    const tStatus = targetTrustlineStatus(account, target);
    if (tStatus === 'notAuthorized') {
      setError(t('wallet:batchConvert.targetNotAuthorized', { code: target.code }));
      return;
    }
    setPhase('quoting');
    try {
      const server = getHorizonServer(horizonUrl);
      if (tStatus === 'missing') {
        const issuer = await server.loadAccount(target.issuer);
        if (issuer?.flags?.auth_required) {
          setError(t('wallet:batchConvert.targetAuthRequired', { code: target.code }));
          setPhase('setup');
          return;
        }
      }
      const [q, feePerOp] = await Promise.all([
        quoteItems(server, items, target, String(slip)),
        resolveFeePerOp(server, { deferred: multisig }),
      ]);
      setQuotes(q);
      setFee(feePerOp);
      setQuotedTarget(target);
      setSelected(new Set(q.filter((x) => x.status === 'ok').map((x) => x.item.id)));
      setPhase('preview');
    } catch (e) {
      console.error('[SKM] batch convert preview failed', e);
      setError(t('wallet:batchConvert.previewFailed', { reason: formatErrorForUi(t, e) }));
      setPhase('setup');
    }
  };

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const setAll = (on) => setSelected(on ? new Set(quotes.filter((q) => q.status === 'ok').map((q) => q.item.id)) : new Set());

  const describeError = (e) => {
    if (e instanceof AmbiguousSubmitResultError) return t('wallet:claimable.ambiguous', { hash: e.hash });
    if (e?.code === 'network_mismatch') return t('wallet:claimable.networkMismatch');
    const codes = e?.response?.data?.extras?.result_codes;
    if (codes) return JSON.stringify(codes);
    return formatErrorForUi(t, e);
  };

  // Lokal signieren und alle Transaktionen nacheinander senden. Bricht beim ersten Fehler ab:
  // jede Transaktion ist fuer sich atomar, bereits gesendete bleiben gueltig.
  const runLocal = async (collected, remember) => {
    if (inFlightRef.current || !chunks.length) return;
    inFlightRef.current = true;
    setError('');
    try {
      if (remember) {
        try {
          await rememberSessionSecrets(publicKey, collected);
        } catch (rememberErr) {
          if (rememberErr instanceof InsecureCryptoContextError) setError(t('secretKey:remember.insecureContextError'));
        }
      }
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      const fresh = await server.loadAccount(publicKey);
      const required = getRequiredThreshold('changeTrust', fresh?.thresholds);
      const { signers, weight } = collectEffectiveSigners(collected, fresh?.signers);
      if (!signers.length || weight < required) {
        setError(t(multisig ? 'wallet:claimable.insufficientWeightJob' : 'wallet:claimable.insufficientWeight', { required }));
        return;
      }
      setShowSecretModal(false);
      setPhase('running');
      const out = [];
      let includeTargetTrustline = targetTrustlineStatus(fresh, quotedTarget) === 'missing';
      let acct = fresh;
      for (let i = 0; i < chunks.length; i += 1) {
        setProgress({ current: i + 1, total: chunks.length });
        if (i > 0) acct = await server.loadAccount(publicKey);
        const tx = buildBatchTx({
          account: acct,
          accountId: publicKey,
          chunk: chunks[i],
          target: quotedTarget,
          includeTargetTrustline,
          fee,
          networkPassphrase,
        });
        signers.forEach((s) => tx.sign(s.keypair));
        try {
          const res = await submitTransactionSafely(server, tx);
          out.push({ ok: true, hash: res?.hash || res?.id || tx.hash().toString('hex'), count: chunks[i].length });
          includeTargetTrustline = false;
        } catch (e) {
          console.error('[SKM] batch convert transaction failed', e);
          out.push({ ok: false, count: chunks[i].length, reason: describeError(e) });
          break;
        }
      }
      setResults(out);
      setPhase('done');
      onDone?.();
    } catch (e) {
      console.error('[SKM] batch convert failed', e);
      setError(describeError(e));
      setPhase('preview');
    } finally {
      inFlightRef.current = false;
      setProgress(null);
    }
  };

  // Multisig: nur die erste Transaktion als Job. Mehrere Jobs mit fortlaufenden Sequenzen
  // waeren riskant: Wird ein spaeterer Job zuerst fertig signiert, scheitert er dauerhaft.
  const prepareJob = async () => {
    if (inFlightRef.current || !chunks.length) return;
    inFlightRef.current = true;
    setError('');
    try {
      const chunk = chunks[0];
      const windows = chunk.map((q) => claimJobTimeoutSeconds(q.item, multisigTimeoutSeconds));
      if (windows.some((w) => w == null)) {
        setError(t('wallet:batchConvert.jobTooLittleTime'));
        return;
      }
      const timeoutSeconds = Math.min(...windows);
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      const fresh = await server.loadAccount(publicKey);
      const tx = buildBatchTx({
        account: fresh,
        accountId: publicKey,
        chunk,
        target: quotedTarget,
        includeTargetTrustline: targetTrustlineStatus(fresh, quotedTarget) === 'missing',
        fee,
        networkPassphrase,
        timeoutSeconds,
      });
      const job = await createMultisigJobFromXdr({ network: isTestnet ? 'testnet' : 'public', accountId: publicKey, txXdr: tx.toXDR() });
      setPreparedJob({
        hash: job.hash || tx.hash().toString('hex'),
        xdr: job.xdr,
        summary: {
          title: t('multisig:prepare.title'),
          subtitle: t('multisig:prepare.subtitle'),
          items: [
            { label: t('wallet:claimable.jobSource'), value: publicKey },
            { label: t('wallet:batchConvert.jobItems'), value: `${chunk.length}` },
            { label: t('wallet:batchConvert.target'), value: quotedTarget.code },
            { label: t('wallet:claimable.jobNetwork'), value: isTestnet ? 'Testnet' : 'Mainnet' },
            { label: t('multisig:detail.idLabel', 'Job-ID'), value: job.id },
            { label: t('wallet:claimable.jobNoteLabel'), value: t('wallet:batchConvert.jobHint') },
          ],
        },
      });
    } catch (e) {
      console.error('[SKM] batch convert job failed', e);
      setError(describeError(e));
    } finally {
      inFlightRef.current = false;
    }
  };

  const statusText = (q) => {
    if (q.status === 'ok') {
      return q.plan.mode === 'claimOnly'
        ? t('wallet:batchConvert.status.claimOnly')
        : `≈ ${f(q.destAmount)} ${quotedTarget?.code || ''}`;
    }
    return t(`wallet:batchConvert.status.${q.status}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="batch-convert-title">
      <div className="my-auto w-full max-w-2xl rounded-2xl bg-white p-5 text-left shadow-xl dark:bg-gray-800">
        <h2 id="batch-convert-title" className="text-lg font-semibold text-gray-900 dark:text-white">{t('wallet:batchConvert.title')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.intro')}</p>

        {(phase === 'setup' || phase === 'quoting') && (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="batch-target" className="block text-sm font-medium text-gray-800 dark:text-gray-200">{t('wallet:batchConvert.target')}</label>
              <select
                id="batch-target"
                value={targetChoice}
                onChange={(e) => setTargetChoice(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm dark:bg-gray-900"
              >
                <option value="XLM">XLM</option>
                {trustlineTargets.map((a) => (
                  <option key={a.key} value={a.key}>{`${a.code} (${shortenAddress(a.issuer)})`}</option>
                ))}
                <option value={CUSTOM}>{t('wallet:batchConvert.customTarget')}</option>
              </select>
              {targetChoice === CUSTOM && (
                <input
                  type="text"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="CODE:G..."
                  aria-label={t('wallet:batchConvert.customTarget')}
                  className="mt-2 w-full rounded border px-2 py-1.5 font-mono text-sm dark:bg-gray-900"
                  spellCheck="false"
                  autoComplete="off"
                />
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('wallet:batchConvert.targetNote')}</p>
            </div>
            <div>
              <label htmlFor="batch-slippage" className="block text-sm font-medium text-gray-800 dark:text-gray-200">{t('wallet:batchConvert.slippage')}</label>
              <input
                id="batch-slippage"
                type="text"
                inputMode="decimal"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="mt-1 w-24 rounded border px-2 py-1.5 text-sm dark:bg-gray-900"
              />
              <span className="ml-1 text-sm text-gray-600 dark:text-gray-300">%</span>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>{t('common:option.cancel', 'Abbrechen')}</button>
              <button type="button" className={btnPrimary} onClick={() => { void loadPreview(); }} disabled={phase === 'quoting'}>
                {phase === 'quoting' ? t('wallet:batchConvert.quoting') : t('wallet:batchConvert.loadPreview')}
              </button>
            </div>
          </div>
        )}

        {phase === 'preview' && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-700 dark:text-gray-300">{t('wallet:batchConvert.selectedCount', { count: selectedQuotes.length, total: quotes.length })}</span>
              <span className="flex gap-1">
                <button type="button" className="rounded px-2 py-1 text-blue-700 hover:bg-blue-50 dark:text-blue-300" onClick={() => setAll(true)}>{t('wallet:batchConvert.selectAll')}</button>
                <button type="button" className="rounded px-2 py-1 text-blue-700 hover:bg-blue-50 dark:text-blue-300" onClick={() => setAll(false)}>{t('wallet:batchConvert.selectNone')}</button>
              </span>
            </div>
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded border dark:divide-gray-700 dark:border-gray-700">
              {quotes.map((q) => (
                <li key={q.item.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="batch-row" data-claimable-id={q.item.id}>
                  <input
                    type="checkbox"
                    checked={q.status === 'ok' && selected.has(q.item.id)}
                    disabled={q.status !== 'ok'}
                    onChange={() => toggle(q.item.id)}
                    aria-label={`${q.item.amount} ${q.item.asset.code}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900 dark:text-white">{f(q.item.amount)} {q.item.asset.code}</div>
                    {!q.item.asset.isNative && <div className="truncate font-mono text-xs text-gray-500" title={q.item.asset.issuer}>{shortenAddress(q.item.asset.issuer)}</div>}
                  </div>
                  <div className={`text-right text-xs ${q.status === 'ok' ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500'}`}>{statusText(q)}</div>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-gray-50 p-3 text-xs dark:bg-gray-900/50">
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.expected')}</dt>
              <dd className="text-right font-semibold tabular-nums">{f(expectedTotal)} {quotedTarget?.code}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.minimum')}</dt>
              <dd className="text-right tabular-nums">{f(minTotal)} {quotedTarget?.code}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.transactions')}</dt>
              <dd className="text-right tabular-nums">{chunks.length}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.fees')}</dt>
              <dd className="text-right tabular-nums">{f(feeTotalXlm)} XLM</dd>
            </dl>
            {needTargetTrustline && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.targetTrustlineNote', { code: quotedTarget.code })}</p>}
            {anyTempTrustline && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.tempTrustlineNote')}</p>}
            {!reserveOk && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t('wallet:batchConvert.insufficientReserve', { needed: f(reserveNeeded), available: f(available) })}</p>}
            {multisig && chunks.length > 1 && <p className="text-xs text-amber-800 dark:text-amber-200">{t('wallet:batchConvert.jobFirstChunkOnly', { count: chunks[0].length })}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:home.tokenNote')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setPhase('setup')}>{t('wallet:batchConvert.back')}</button>
              {multisig && (
                <button type="button" className={btnSecondary} onClick={() => { void prepareJob(); }} disabled={!chunks.length || !reserveOk}>
                  {t('wallet:claimable.prepareJob')}
                </button>
              )}
              <button type="button" className={btnPrimary} onClick={() => setShowSecretModal(true)} disabled={!chunks.length || !reserveOk}>
                {t('wallet:batchConvert.start', { count: selectedQuotes.length })}
              </button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <p role="status" className="mt-4 text-sm text-blue-700 dark:text-blue-300">
            {t('wallet:batchConvert.running', { current: progress?.current || 1, total: progress?.total || chunks.length })}
          </p>
        )}

        {phase === 'done' && (
          <div className="mt-4 space-y-2">
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? 'text-green-700 dark:text-green-400 break-all' : 'text-red-700 dark:text-red-300 break-all'}>
                  {r.ok
                    ? t('wallet:batchConvert.txOk', { index: i + 1, count: r.count, hash: r.hash })
                    : t('wallet:batchConvert.txFailed', { index: i + 1, count: r.count, reason: r.reason })}
                </li>
              ))}
            </ul>
            {results.some((r) => !r.ok) && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.stoppedNote')}</p>}
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} onClick={onClose}>{t('common:close', 'Schließen')}</button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(collected, remember) => { void runLocal(collected, remember); }}
          onCancel={() => setShowSecretModal(false)}
          errorMessage={error}
          thresholds={account?.thresholds}
          signers={account?.signers || []}
          operationType="changeTrust"
          requiredThreshold={getRequiredThreshold('changeTrust', account?.thresholds)}
          isProcessing={phase === 'running'}
          account={account}
          initialSecretValues={prefill}
        />
      )}
      {preparedJob && (
        <MultisigPrepareDialog
          open={!!preparedJob}
          onClose={() => { setPreparedJob(null); onClose(); }}
          hash={preparedJob.hash}
          xdr={preparedJob.xdr}
          summary={preparedJob.summary}
        />
      )}
    </div>
  );
}

