import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getNetworkConfig, passphraseFor } from '../../config/networks.js';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';
import { isMultisigAccount } from '../../utils/stellar/isMultisigAccount.js';
import { getMultisigTxTimeout } from '../../utils/getMultisigTxTimeout.js';
import { formatValidUntil } from '../../utils/multisig/formatValidUntil.js';
import { useSettings } from '../../utils/useSettings.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { describeOperations } from '../../utils/multisig/describeOperations.js';
import { fromStroops, poolAssetFor, quoteWithdraw, toStroops } from '../../utils/stellar/liquidityPools.js';
import { checkWithdrawPreconditions, findPoolShareLine } from '../../utils/stellar/liquidityChecks.js';
import { buildLiquidityWithdrawTransaction } from '../../utils/stellar/tradingTransactions.js';
import { formatAssetLabelWithIssuer } from '../trading/assetSearchUtils.js';
import useLiquidityAction from './hooks/useLiquidityAction.js';
import { assertSignerWeight, describeLiquidityError, loadFreshState, previewAccount } from './liquiditySubmit.js';
import { formatPoolAmount, formatSlippage, parseAmountInput } from './formatPoolAmount.js';
import { parseSlippagePercent, sharesFromPercent } from './dialogInputs.js';
import LiquidityDialogShell, { BTN_PRIMARY, BTN_SECONDARY, FactList, INPUT, NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN, OperationsPreview } from './LiquidityDialogShell.jsx';
import { CheckProblems, ResultNote, SlippageField } from './dialogParts.jsx';
import { JobNotes, PreparedJobDialog } from './jobParts.jsx';

const PERCENT_PRESETS = ['25', '50', '75', '100'];

function buildWithdrawTx({ account, pool, quote, shares, removePoolTrust, feePerOp, network, timeoutSeconds }) {
  return buildLiquidityWithdrawTransaction({
    account,
    liquidityPoolId: pool.poolId,
    amount: fromStroops(shares),
    minAmountA: fromStroops(quote.minAmountA),
    minAmountB: fromStroops(quote.minAmountB),
    removePoolTrust,
    poolAsset: poolAssetFor(pool.assetA, pool.assetB),
    fee: feePerOp,
    networkPassphrase: passphraseFor(network),
    timeoutSeconds,
  });
}

/**
 * Abheben aus einem nativen Pool, direkt signiert oder bei Multisig-Konten
 * zusaetzlich als Multisig-Job. Prozent oder Share-Betrag,
 * Mindestbetraege nach Slippage. Bei 100 % optional die Pool-Trustline
 * entfernen (Default an). Vor dem Bauen wird neu geladen; liegen die neuen
 * Betraege unter den bestaetigten Mindestbetraegen, wird abgebrochen.
 */
export default function WithdrawDialog({ poolId, publicKey, network, onClose, onDone, onBackgroundResult }) {
  const { t, i18n } = useTranslation(['liquidity', 'errors', 'submitTransaction', 'common']);
  const { t: tOps } = useTranslation('multisig');
  const locale = i18n.language;
  const { multisigTimeoutSeconds } = useSettings();
  const action = useLiquidityAction({ publicKey, network, poolId, operationType: 'liquidityPoolWithdraw', t, onDone, onBackgroundResult });
  const { data } = action;
  const pool = data.pool;
  const multisig = isMultisigAccount(data.account);
  const [mode, setMode] = useState('percent');
  const [percentInput, setPercentInput] = useState('');
  const [sharesInput, setSharesInput] = useState('');
  const [slippageInput, setSlippageInput] = useState('0.5');
  const [removeTrust, setRemoveTrust] = useState(true);
  const [confirmed, setConfirmed] = useState(null);
  const [reviewError, setReviewError] = useState('');

  const shareLine = data.account ? findPoolShareLine(data.account, poolId) : null;
  const shareBalance = shareLine ? toStroops(shareLine.balance) : 0n;
  const shares = mode === 'percent' ? sharesFromPercent(shareBalance, percentInput) : parseAmountInput(sharesInput);
  const sharesTooMany = shares !== null && shares > shareBalance;
  const isFull = shares !== null && shares > 0n && shares === shareBalance;
  const effectiveRemove = isFull && removeTrust;
  const slippage = parseSlippagePercent(slippageInput);

  const quote = useMemo(
    () => (pool && shares !== null && !sharesTooMany && slippage.valid ? quoteWithdraw({ pool, shares, slippageBps: slippage.bps }) : null),
    [pool, shares, sharesTooMany, slippage.valid, slippage.bps]
  );
  const check = useMemo(() => {
    if (!data.account || !pool || quote?.status !== 'ok') return null;
    return checkWithdrawPreconditions({ account: data.account, pool, shares, amountA: quote.amountA, amountB: quote.amountB, feePerOp: data.feePerOp, opCount: effectiveRemove ? 2 : 1 });
  }, [data.account, data.feePerOp, pool, quote, shares, effectiveRemove]);

  const edit = (setter) => (value) => {
    setter(value);
    setConfirmed(null);
    setReviewError('');
  };
  const labelA = pool ? formatAssetLabelWithIssuer(pool.assetA) : '';
  const labelB = pool ? formatAssetLabelWithIssuer(pool.assetB) : '';

  const handleReview = () => {
    setReviewError('');
    if (!check || check.problems.length) return;
    try {
      const tx = buildWithdrawTx({ account: previewAccount(data.account), pool, quote, shares, removePoolTrust: effectiveRemove, feePerOp: data.feePerOp, network });
      const poolInfo = { [pool.poolId]: { assetA: pool.assetA, assetB: pool.assetB } };
      setConfirmed({ shares, removePoolTrust: effectiveRemove, slippageBps: quote.slippageBps, quote, lines: describeOperations(tx.operations, tOps, publicKey, { poolInfo, locale }) });
    } catch (err) {
      setReviewError(describeLiquidityError(t, err));
    }
  };

  // Frischer Stand gegen die bestaetigten Werte (direkter Weg und Job-Weg gleich):
  // { changed, fresh } bei Abweichung, sonst { fresh }.
  const verifyFresh = async (server, c, feePerOp) => {
    const fresh = await loadFreshState(server, publicKey, poolId);
    const freshQuote = quoteWithdraw({ pool: fresh.pool, shares: c.shares, slippageBps: c.slippageBps });
    const freshLine = findPoolShareLine(fresh.account, poolId);
    const freshBalance = freshLine ? toStroops(freshLine.balance) : 0n;
    if (freshQuote.status !== 'ok' || freshQuote.amountA < c.quote.minAmountA || freshQuote.amountB < c.quote.minAmountB) {
      return { changed: t('liquidity:withdraw.priceChanged'), fresh };
    }
    if (c.removePoolTrust && freshBalance !== c.shares) return { changed: t('liquidity:dialog.checksChanged'), fresh };
    const freshCheck = checkWithdrawPreconditions({ account: fresh.account, pool: fresh.pool, shares: c.shares, amountA: freshQuote.amountA, amountB: freshQuote.amountB, feePerOp, opCount: c.removePoolTrust ? 2 : 1 });
    if (freshCheck.problems.length) return { changed: t('liquidity:dialog.checksChanged'), fresh };
    return { fresh };
  };

  const handleSign = () => {
    const c = confirmed;
    action.begin(c, async (server, collected, alive, send) => {
      const v = await verifyFresh(server, c, data.feePerOp);
      if (!alive()) return null;
      if (v.changed) {
        setConfirmed(null);
        return v;
      }
      assertSignerWeight(v.fresh.account, collected, 'liquidityPoolWithdraw');
      if (!alive()) return null;
      // Bestaetigte Mindestbetraege verwenden, nicht die neu berechneten.
      const tx = buildWithdrawTx({ account: v.fresh.account, pool: v.fresh.pool, quote: c.quote, shares: c.shares, removePoolTrust: c.removePoolTrust, feePerOp: data.feePerOp, network });
      const res = await send(tx);
      return { hash: res?.hash || res?.id || '' };
    });
  };

  // Multisig-Job: gleiche Pruefung, Fee fuer spaeteres Einreichen (deferred),
  // Gueltigkeit aus den Einstellungen, bestaetigte Mindestbetraege.
  const handlePrepareJob = () => {
    const c = confirmed;
    void action.prepareJob(async (server, alive) => {
      const feePerOp = await resolveFeePerOp(server, { deferred: true });
      const v = await verifyFresh(server, c, feePerOp);
      if (!alive()) return null;
      if (v.changed) {
        setConfirmed(null);
        return v;
      }
      const timeoutSeconds = getMultisigTxTimeout({ immediateSubmit: false, multisigTimeoutSeconds });
      const tx = buildWithdrawTx({ account: v.fresh.account, pool: v.fresh.pool, quote: c.quote, shares: c.shares, removePoolTrust: c.removePoolTrust, feePerOp, network, timeoutSeconds });
      return {
        tx,
        items: [
          { label: t('liquidity:job.source'), value: publicKey },
          { label: t('liquidity:job.network'), value: getNetworkConfig(network).label },
          { label: t('liquidity:job.pool'), value: `${labelA} / ${labelB} (${pool.poolId})` },
          { label: t('liquidity:withdraw.sharesToWithdraw'), value: formatPoolAmount(c.shares, locale) },
          { label: t('liquidity:withdraw.minimum', { asset: labelA }), value: formatPoolAmount(c.quote.minAmountA, locale) },
          { label: t('liquidity:withdraw.minimum', { asset: labelB }), value: formatPoolAmount(c.quote.minAmountB, locale) },
          { label: t('liquidity:job.slippage'), value: `${formatSlippage(c.quote.slippageBps, locale)} %` },
          { label: t('liquidity:job.poolTrust'), value: t(c.removePoolTrust ? 'liquidity:job.poolTrustRemove' : 'liquidity:job.poolTrustKeep') },
          { label: t('liquidity:job.validUntil'), value: formatValidUntil(tx.timeBounds?.maxTime, locale, t) },
          { label: t('liquidity:job.noteLabel'), value: [t('liquidity:job.withdrawHint'), c.removePoolTrust ? t('liquidity:job.removeTrustHint') : ''].filter(Boolean).join(' ') },
        ],
      };
    });
  };

  let body;
  if (data.loading && !pool) body = <p className="text-xs">{t('liquidity:dialog.loading')}</p>;
  else if (data.error && !pool) body = <div className={NOTE_ERROR}>{data.error}</div>;
  else if (action.result) body = <ResultNote result={action.result} onClose={onClose} />;
  else if (shareBalance === 0n) body = <div className={NOTE_NEUTRAL}>{t('liquidity:withdraw.noShares')}</div>;
  else {
    body = (
      <>
        {action.notice && <div className={NOTE_WARN} role="alert">{action.notice}</div>}
        <FactList rows={[[t('liquidity:withdraw.balance'), formatPoolAmount(shareBalance, locale)]]} />
        <div className="flex gap-2" role="tablist">
          {['percent', 'shares'].map((value) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => edit(setMode)(value)}
              className={mode === value ? `${BTN_PRIMARY} px-3 py-1 text-xs` : `${BTN_SECONDARY} px-3 py-1 text-xs`}>
              {t(`liquidity:withdraw.mode.${value}`)}
            </button>
          ))}
        </div>
        {mode === 'percent' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {PERCENT_PRESETS.map((p) => (
                <button key={p} type="button" className={`${BTN_SECONDARY} px-3 py-1 text-xs`} onClick={() => edit(setPercentInput)(p)}>{p} %</button>
              ))}
            </div>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold">{t('liquidity:withdraw.percent')}</span>
              <input value={percentInput} onChange={(e) => edit(setPercentInput)(e.target.value)} className={`${INPUT} max-w-[8rem]`} inputMode="decimal" />
            </label>
          </div>
        ) : (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold">{t('liquidity:withdraw.shares')}</span>
            <input value={sharesInput} onChange={(e) => edit(setSharesInput)(e.target.value)} className={INPUT} inputMode="decimal" />
          </label>
        )}
        {((mode === 'percent' && percentInput && shares === null) || (mode === 'shares' && sharesInput && shares === null)) && (
          <div className={NOTE_ERROR}>{t('liquidity:dialog.invalidAmount')}</div>
        )}
        {sharesTooMany && <div className={NOTE_ERROR}>{t('liquidity:withdraw.tooMany')}</div>}
        <SlippageField value={slippageInput} onChange={edit(setSlippageInput)} valid={slippage.valid} />
        {quote && (
          <FactList rows={[
            [t('liquidity:withdraw.sharesToWithdraw'), formatPoolAmount(shares, locale)],
            [t('liquidity:withdraw.expected', { asset: labelA }), formatPoolAmount(quote.amountA, locale)],
            [t('liquidity:withdraw.expected', { asset: labelB }), formatPoolAmount(quote.amountB, locale)],
            [t('liquidity:withdraw.minimum', { asset: labelA }), formatPoolAmount(quote.minAmountA, locale)],
            [t('liquidity:withdraw.minimum', { asset: labelB }), formatPoolAmount(quote.minAmountB, locale)],
            check && [t('liquidity:dialog.fee'), `${formatPoolAmount(check.feeStroops, locale)} XLM`],
          ]} />
        )}
        {quote && quote.status !== 'ok' && <div className={NOTE_NEUTRAL}>{t(`liquidity:withdraw.status.${quote.status}`)}</div>}
        {isFull && (
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={removeTrust} onChange={(e) => edit(setRemoveTrust)(e.target.checked)} />
            <span>{t('liquidity:withdraw.removeTrust')}</span>
          </label>
        )}
        {check && <CheckProblems problems={check.problems} pool={pool} />}
        {reviewError && <div className={NOTE_ERROR}>{reviewError}</div>}
        <JobNotes jobError={action.jobError} jobCreated={action.jobCreated} />
        {confirmed ? (
          <>
            <OperationsPreview lines={confirmed.lines} legend={t('liquidity:dialog.legend', { a: labelA, b: labelB })} />
            {multisig && <JobNotes hints={[t('liquidity:job.withdrawHint'), confirmed.removePoolTrust ? t('liquidity:job.removeTrustHint') : '']} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={handleSign} disabled={action.processing || action.jobCreated}>{t('liquidity:dialog.sign')}</button>
              {multisig && (
                <button type="button" className={BTN_SECONDARY} onClick={handlePrepareJob} disabled={action.processing || action.jobCreated}>{t('liquidity:job.prepare')}</button>
              )}
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirmed(null)} disabled={action.jobCreated}>{t('liquidity:dialog.back')}</button>
            </div>
          </>
        ) : (
          <button type="button" className={BTN_PRIMARY} onClick={handleReview} disabled={!check || check.problems.length > 0}>
            {t('liquidity:dialog.review')}
          </button>
        )}
      </>
    );
  }

  return (
    <LiquidityDialogShell title={t('liquidity:withdraw.title')} onClose={onClose} closeDisabled={action.processing} testId="withdraw-dialog">
      {body}
      {action.showSecretModal && <SecretKeyModal {...action.modalProps} />}
      <PreparedJobDialog job={action.preparedJob} onClose={onClose} />
    </LiquidityDialogShell>
  );
}
