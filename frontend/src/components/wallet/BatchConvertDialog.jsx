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
import { claimJobTimeoutSeconds, classifyClaimableBalances, fetchClaimableBalances } from '../../utils/stellar/claimableBalances.js';
import {
  DEFAULT_BATCH_SLIPPAGE,
  NATIVE_TARGET,
  assetLabel,
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
const TRUSTLINE_LIST_LIMIT = 50;
const PREVIEW_MAX_AGE_MS = 2 * 60 * 1000;

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

  // Ziel: XLM, eine eigene Trustline (mit Suche) oder ein frei eingegebenes Asset
  const [targetMode, setTargetMode] = React.useState('xlm'); // xlm | trustline | custom
  const [trustlineKey, setTrustlineKey] = React.useState('');
  const [trustlineFilter, setTrustlineFilter] = React.useState('');
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
  const [jobCreated, setJobCreated] = React.useState(false);
  const [quotedAt, setQuotedAt] = React.useState(0);
  const [quotedSlippage, setQuotedSlippage] = React.useState('');
  const inFlightRef = React.useRef(false);

  let target = NATIVE_TARGET;
  if (targetMode === 'custom') target = parseTargetAsset(customTarget);
  else if (targetMode === 'trustline') target = trustlineTargets.find((a) => a.key === trustlineKey) || null;

  const filteredTrustlines = React.useMemo(() => {
    const q = trustlineFilter.trim().toLowerCase();
    const list = q
      ? trustlineTargets.filter((a) => a.code.toLowerCase().includes(q) || a.issuer.toLowerCase().includes(q))
      : trustlineTargets;
    return [...list].sort((a, b) => a.code.localeCompare(b.code) || a.issuer.localeCompare(b.issuer));
  }, [trustlineFilter, trustlineTargets]);

  React.useEffect(() => {
    if (!showSecretModal) {
      setPrefill([]); // entschluesselte Secrets nicht laenger als noetig im State halten
      return undefined;
    }
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
    if (targetMode === 'trustline' && !target) {
      setError(t('wallet:batchConvert.selectTrustline'));
      return;
    }
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
      setQuotedAt(Date.now());
      setQuotedSlippage(String(slip));
      setJobCreated(false);
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
  const targetText = quotedTarget ? assetLabel(quotedTarget, shortenAddress) : '';
  const targetLooksNative = !!quotedTarget && !quotedTarget.isNative && quotedTarget.code.toUpperCase() === 'XLM';

  // Vor dem Signieren gegen den aktuellen Stand pruefen: Konto, Ziel-Trustline und die
  // ausgewaehlten Claimable Balances muessen noch genau so sein wie in der Vorschau. Sonst
  // stimmen Plan und Aufteilung nicht mehr (z. B. mehr als 100 Operationen oder eine
  // inzwischen angelegte Trustline, die am Ende geloescht wuerde).
  const verifyFresh = async (server, quotesToCheck) => {
    if (Date.now() - quotedAt > PREVIEW_MAX_AGE_MS) return { problem: 'previewTooOld' };
    const fresh = await server.loadAccount(publicKey);
    if (targetTrustlineStatus(fresh, quotedTarget) !== targetStatus) return { problem: 'changedSincePreview' };
    const { records } = await fetchClaimableBalances(server, publicKey);
    const ids = new Set(quotesToCheck.map((q) => q.item.id));
    const freshItems = new Map(classifyClaimableBalances(records.filter((r) => ids.has(r.id)), fresh).map((it) => [it.id, it]));
    const unchanged = quotesToCheck.every((q) => {
      const it = freshItems.get(q.item.id);
      return it && it.claimableNow && !it.blockedReason && it.hasTrustline === q.item.hasTrustline && it.amount === q.item.amount;
    });
    return unchanged ? { fresh } : { problem: 'changedSincePreview' };
  };

  // Lokal signieren und alle Transaktionen nacheinander senden. Bricht beim ersten Fehler ab:
  // jede Transaktion ist fuer sich atomar, bereits bestaetigte bleiben gueltig.
  const runLocal = async (collected, remember) => {
    if (inFlightRef.current || !chunks.length) return;
    inFlightRef.current = true;
    setError('');
    const out = [];
    let started = false;
    try {
      const server = getHorizonServer(horizonUrl);
      await assertHorizonNetwork(server, networkPassphrase);
      const check = await verifyFresh(server, selectedQuotes);
      if (check.problem) {
        setShowSecretModal(false);
        setError(t(`wallet:batchConvert.${check.problem}`));
        return;
      }
      const { fresh } = check;
      const required = getRequiredThreshold('changeTrust', fresh?.thresholds);
      const { signers, weight } = collectEffectiveSigners(collected, fresh?.signers);
      if (!signers.length || weight < required) {
        setError(t(multisig ? 'wallet:claimable.insufficientWeightJob' : 'wallet:claimable.insufficientWeight', { required }));
        return;
      }
      setShowSecretModal(false);
      setPhase('running');
      started = true;
      let includeTargetTrustline = needTargetTrustline;
      let acct = fresh;
      for (let i = 0; i < chunks.length; i += 1) {
        setProgress({ current: i + 1, total: chunks.length });
        const count = chunks[i].length;
        try {
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
          const res = await submitTransactionSafely(server, tx);
          out.push({ status: 'ok', hash: res?.hash || res?.id || tx.hash().toString('hex'), count });
          includeTargetTrustline = false;
        } catch (e) {
          console.error('[SKM] batch convert transaction failed', e);
          if (e instanceof AmbiguousSubmitResultError) out.push({ status: 'ambiguous', hash: e.hash, count });
          else out.push({ status: 'failed', count, reason: describeError(e) });
          break;
        }
      }
      // Erst nach mindestens einer erfolgreichen Transaktion merken
      if (remember && out.some((r) => r.status === 'ok')) {
        try {
          await rememberSessionSecrets(publicKey, collected);
        } catch (rememberErr) {
          if (rememberErr instanceof InsecureCryptoContextError) setError(t('secretKey:remember.insecureContextError'));
        }
      }
    } catch (e) {
      console.error('[SKM] batch convert failed', e);
      setError(describeError(e));
    } finally {
      inFlightRef.current = false;
      setProgress(null);
      // Teilerfolge nie verwerfen: sobald gesendet wurde, Ergebnis zeigen und neu laden
      if (started) {
        setResults(out);
        setPhase('done');
        onDone?.();
      }
    }
  };

  // Multisig: nur die erste Transaktion als Job. Mehrere Jobs mit fortlaufenden Sequenzen
  // waeren riskant: Wird ein spaeterer Job zuerst fertig signiert, scheitert er dauerhaft.
  const prepareJob = async () => {
    if (inFlightRef.current || !chunks.length || jobCreated) return;
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
      const check = await verifyFresh(server, chunk);
      if (check.problem) {
        setError(t(`wallet:batchConvert.${check.problem}`));
        return;
      }
      const tx = buildBatchTx({
        account: check.fresh,
        accountId: publicKey,
        chunk,
        target: quotedTarget,
        includeTargetTrustline: needTargetTrustline,
        fee,
        networkPassphrase,
        timeoutSeconds,
      });
      const job = await createMultisigJobFromXdr({ network: isTestnet ? 'testnet' : 'public', accountId: publicKey, txXdr: tx.toXDR() });
      setJobCreated(true);
      const chunkMin = chunk.reduce((acc, q) => acc + Number(q.destMin || 0), 0);
      setPreparedJob({
        hash: job.hash || tx.hash().toString('hex'),
        xdr: job.xdr,
        summary: {
          title: t('multisig:prepare.title'),
          subtitle: t('multisig:prepare.subtitle'),
          items: [
            { label: t('wallet:claimable.jobSource'), value: publicKey },
            { label: t('wallet:batchConvert.jobItems'), value: `${chunk.length}` },
            { label: t('wallet:batchConvert.target'), value: targetText },
            { label: t('wallet:batchConvert.jobMinimum'), value: `${f(chunkMin)} ${targetText}` },
            { label: t('wallet:batchConvert.jobSlippage'), value: `${quotedSlippage} %` },
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
        : `≈ ${f(q.destAmount)} ${targetText}`;
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
            <fieldset>
              <legend className="block text-sm font-medium text-gray-800 dark:text-gray-200">{t('wallet:batchConvert.target')}</legend>
              <div className="mt-1 space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="batch-target-mode" checked={targetMode === 'xlm'} onChange={() => setTargetMode('xlm')} />
                  XLM
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="batch-target-mode"
                    checked={targetMode === 'trustline'}
                    onChange={() => setTargetMode('trustline')}
                    disabled={trustlineTargets.length === 0}
                  />
                  {t('wallet:batchConvert.fromTrustlines', { count: trustlineTargets.length })}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="batch-target-mode" checked={targetMode === 'custom'} onChange={() => setTargetMode('custom')} />
                  {t('wallet:batchConvert.customTarget')}
                </label>
              </div>
              {targetMode === 'trustline' && (
                <div className="mt-2 space-y-1">
                  <input
                    type="search"
                    value={trustlineFilter}
                    onChange={(e) => setTrustlineFilter(e.target.value)}
                    placeholder={t('wallet:batchConvert.trustlineSearch')}
                    aria-label={t('wallet:batchConvert.trustlineSearch')}
                    className="w-full rounded border px-2 py-1.5 text-sm dark:bg-gray-900"
                    spellCheck="false"
                    autoComplete="off"
                  />
                  <ul className="max-h-48 overflow-y-auto rounded border dark:border-gray-700" role="listbox" aria-label={t('wallet:batchConvert.target')}>
                    {filteredTrustlines.slice(0, TRUSTLINE_LIST_LIMIT).map((a) => (
                      <li key={a.key}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={trustlineKey === a.key}
                          onClick={() => setTrustlineKey(a.key)}
                          className={`flex w-full items-center justify-between gap-2 border-0 px-2 py-1.5 text-left text-sm ${trustlineKey === a.key ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-100' : 'bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                        >
                          <span>{a.code}</span>
                          <span className="font-mono text-xs text-gray-500" title={a.issuer}>{shortenAddress(a.issuer)}</span>
                        </button>
                      </li>
                    ))}
                    {filteredTrustlines.length === 0 && (
                      <li className="px-2 py-1.5 text-xs text-gray-500">{t('wallet:batchConvert.trustlineNoMatch')}</li>
                    )}
                  </ul>
                  {filteredTrustlines.length > TRUSTLINE_LIST_LIMIT && (
                    <p className="text-xs text-gray-500">{t('wallet:batchConvert.trustlineMore', { count: filteredTrustlines.length - TRUSTLINE_LIST_LIMIT })}</p>
                  )}
                </div>
              )}
              {targetMode === 'custom' && (
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
            </fieldset>
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
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {f(q.item.amount)} {q.item.asset.code}
                      {q.item.hidden && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">{t('wallet:batchConvert.hiddenTag')}</span>}
                    </div>
                    {!q.item.asset.isNative && <div className="truncate font-mono text-xs text-gray-500" title={q.item.asset.issuer}>{shortenAddress(q.item.asset.issuer)}</div>}
                  </div>
                  <div className={`text-right text-xs ${q.status === 'ok' ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500'}`}>{statusText(q)}</div>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-gray-50 p-3 text-xs dark:bg-gray-900/50">
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.expected')}</dt>
              <dd className="text-right font-semibold tabular-nums">{f(expectedTotal)} {targetText}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.minimum')}</dt>
              <dd className="text-right tabular-nums">{f(minTotal)} {targetText}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.transactions')}</dt>
              <dd className="text-right tabular-nums">{chunks.length}</dd>
              <dt className="text-gray-600 dark:text-gray-400">{t('wallet:batchConvert.fees')}</dt>
              <dd className="text-right tabular-nums">{f(feeTotalXlm)} XLM</dd>
            </dl>
            {targetLooksNative && (
              <p role="alert" className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {t('wallet:activity.fakeNative', 'Token, kein natives XLM')}: {t('wallet:activity.fakeNativeHint', 'Das ist ein Token eines Herausgebers, nicht das native XLM des Netzwerks.')}
              </p>
            )}
            {needTargetTrustline && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.targetTrustlineNote', { code: targetText })}</p>}
            {anyTempTrustline && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.tempTrustlineNote')}</p>}
            {!reserveOk && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t('wallet:batchConvert.insufficientReserve', { needed: f(reserveNeeded), available: f(available) })}</p>}
            {jobCreated && <p role="status" className="text-xs text-green-700 dark:text-green-400">{t('wallet:batchConvert.jobCreated')}</p>}
            {multisig && chunks.length > 1 && <p className="text-xs text-amber-800 dark:text-amber-200">{t('wallet:batchConvert.jobFirstChunkOnly', { count: chunks[0].length })}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:home.tokenNote')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setPhase('setup')}>{t('wallet:batchConvert.back')}</button>
              <button type="button" className={btnSecondary} onClick={() => { void loadPreview(); }}>{t('wallet:batchConvert.loadPreview')}</button>
              {multisig && (
                <button type="button" className={btnSecondary} onClick={() => { void prepareJob(); }} disabled={!chunks.length || !reserveOk || jobCreated}>
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
                <li key={i} className={`break-all ${r.status === 'ok' ? 'text-green-700 dark:text-green-400' : r.status === 'ambiguous' ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
                  {r.status === 'ok' && t('wallet:batchConvert.txOk', { index: i + 1, count: r.count, hash: r.hash })}
                  {r.status === 'ambiguous' && t('wallet:batchConvert.txAmbiguous', { index: i + 1, count: r.count, hash: r.hash })}
                  {r.status === 'failed' && t('wallet:batchConvert.txFailed', { index: i + 1, count: r.count, reason: r.reason })}
                </li>
              ))}
            </ul>
            {results.some((r) => r.status !== 'ok') && <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:batchConvert.stoppedNote')}</p>}
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

