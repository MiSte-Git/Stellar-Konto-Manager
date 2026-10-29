import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { horizonUrlFor, passphraseFor } from '../../config/networks.js';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { describeOperations } from '../../utils/multisig/describeOperations.js';
import {
  fromStroops,
  poolAssetFor,
  poolPriceWithin,
  poolSidesInOrder,
  priceWithinBounds,
  quoteDeposit,
  simulateDeposit,
} from '../../utils/stellar/liquidityPools.js';
import { checkDepositPreconditions, findAssetLine, isOwnIssuedAsset } from '../../utils/stellar/liquidityChecks.js';
import { buildLiquidityDepositTransaction } from '../../utils/stellar/tradingTransactions.js';
import { formatAssetLabelWithIssuer, getAssetCode } from '../trading/assetSearchUtils.js';
import useLiquidityAction from './hooks/useLiquidityAction.js';
import { assertSignerWeight, describeLiquidityError, loadFreshState, loadIssuerFlags, previewAccount } from './liquiditySubmit.js';
import { formatPoolAmount, formatPrice, parseAmountInput } from './formatPoolAmount.js';
import { parseSlippagePercent } from './dialogInputs.js';
import LiquidityDialogShell, { BTN_PRIMARY, BTN_SECONDARY, FactList, INPUT, NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN, OperationsPreview } from './LiquidityDialogShell.jsx';
import { CheckInfos, CheckProblems, ResultNote, SlippageField } from './dialogParts.jsx';

function buildDepositTx({ account, pool, check, quote, feePerOp, network }) {
  return buildLiquidityDepositTransaction({
    account,
    missingTrustAssets: check.missingTrustAssets,
    poolAsset: poolAssetFor(pool.assetA, pool.assetB),
    needPoolTrust: check.needPoolTrust,
    liquidityPoolId: pool.poolId,
    maxAmountA: fromStroops(quote.maxAmountA),
    maxAmountB: fromStroops(quote.maxAmountB),
    minPrice: quote.minPrice,
    maxPrice: quote.maxPrice,
    fee: feePerOp,
    networkPassphrase: passphraseFor(network),
  });
}

/**
 * Einzahlen in einen nativen Pool (direkt signiert, kein Multisig-Job).
 * Der Nutzer gibt den Betrag fuer eine Seite ein, die Gegenseite folgt dem
 * Pool-Verhaeltnis. Vor dem Signieren: Klartext der Operationen und Fakten.
 * Direkt vor dem Bauen werden Konto und Pool neu geladen; liegt der Preis dann
 * ausserhalb der bestaetigten Grenzen, wird abgebrochen und neu angezeigt.
 */
export default function DepositDialog({ poolId, firstAsset, publicKey, network, onClose, onDone, onBackgroundResult }) {
  const { t, i18n } = useTranslation(['liquidity', 'errors', 'submitTransaction', 'common']);
  const { t: tOps } = useTranslation('multisig');
  const locale = i18n.language;
  const action = useLiquidityAction({ publicKey, network, poolId, operationType: 'liquidityPoolDeposit', t, onDone, onBackgroundResult });
  const { data } = action;
  const pool = data.pool;
  const [inputIndex, setInputIndex] = useState(0);
  const [amountInput, setAmountInput] = useState('');
  const [slippageInput, setSlippageInput] = useState('0.5');
  const [issuerFlags, setIssuerFlags] = useState({});
  const [confirmed, setConfirmed] = useState(null);
  const [reviewError, setReviewError] = useState('');

  const sides = useMemo(() => (pool ? poolSidesInOrder(pool, firstAsset) : []), [pool, firstAsset]);
  // Nutzerreihenfolge B/A: Preise invertiert anzeigen (Definition bleibt A/B).
  const invert = !!pool && sides[0].asset.equals(pool.assetB);
  const inputAsset = sides[inputIndex]?.asset || null;
  const side = pool && inputAsset && inputAsset.equals(pool.assetB) ? 'B' : 'A';
  const amount = parseAmountInput(amountInput);
  const slippage = parseSlippagePercent(slippageInput);

  const quote = useMemo(
    () => (pool && amount !== null && slippage.valid ? quoteDeposit({ pool, side, amount, slippageBps: slippage.bps }) : null),
    [pool, amount, side, slippage.valid, slippage.bps]
  );
  const check = useMemo(() => {
    if (!data.account || !pool || quote?.status !== 'ok') return null;
    return checkDepositPreconditions({ account: data.account, pool, maxAmountA: quote.maxAmountA, maxAmountB: quote.maxAmountB, feePerOp: data.feePerOp, issuerFlags });
  }, [data.account, data.feePerOp, pool, quote, issuerFlags]);

  const amountOf = (asset) => (asset.equals(pool.assetA) ? quote.amountA : quote.amountB);
  const labelOf = (asset) => formatAssetLabelWithIssuer(asset);
  const displayMin = (q) => formatPrice(invert ? q.maxPrice : q.minPrice, locale, invert);
  const displayMax = (q) => formatPrice(invert ? q.minPrice : q.maxPrice, locale, invert);
  const priceLabel = sides.length ? `${getAssetCode(sides[0].asset)}/${getAssetCode(sides[1].asset)}` : '';
  const currentPrice = pool ? formatPrice({ n: Number(pool.reserveA), d: Number(pool.reserveB) }, locale, invert) : '—';

  const editInput = (setter) => (value) => {
    setter(value);
    setConfirmed(null);
    setReviewError('');
  };

  // Fuer Assets ohne Trustline die Issuer-Flags laden (auth_required, Clawback), damit
  // die Vorpruefung diese Fakten nennen kann. Selbst ausgegebene Assets brauchen das nicht.
  useEffect(() => {
    if (!data.account || !pool) return undefined;
    const missing = [pool.assetA, pool.assetB]
      .filter((a) => !a.isNative() && !isOwnIssuedAsset(data.account, a) && !findAssetLine(data.account, a));
    if (!missing.length) return undefined;
    let cancelled = false;
    loadIssuerFlags(getHorizonServer(horizonUrlFor(network)), missing)
      .then((flags) => { if (!cancelled) setIssuerFlags(flags); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data.account, pool, network]);

  const handleReview = () => {
    setReviewError('');
    if (!check || check.problems.length) return;
    try {
      const tx = buildDepositTx({ account: previewAccount(data.account), pool, check, quote, feePerOp: data.feePerOp, network });
      setConfirmed({ side, amount, slippageBps: quote.slippageBps, quote, check, lines: describeOperations(tx.operations, tOps, publicKey) });
    } catch (err) {
      setReviewError(describeLiquidityError(t, err));
    }
  };

  const handleSign = () => {
    const c = confirmed;
    action.begin(c, async (server, collected, alive, send) => {
      const fresh = await loadFreshState(server, publicKey, poolId);
      if (!alive()) return null;
      const sim = simulateDeposit(fresh.pool, c.quote.maxAmountA, c.quote.maxAmountB);
      const priceOk = poolPriceWithin(fresh.pool, c.quote.minPrice, c.quote.maxPrice)
        && sim.shares > 0n
        && priceWithinBounds(sim.amountA, sim.amountB, c.quote.minPrice, c.quote.maxPrice);
      const freshCheck = checkDepositPreconditions({ account: fresh.account, pool: fresh.pool, maxAmountA: c.quote.maxAmountA, maxAmountB: c.quote.maxAmountB, feePerOp: data.feePerOp, issuerFlags });
      const sameOps = freshCheck.needPoolTrust === c.check.needPoolTrust
        && freshCheck.missingTrustAssets.length === c.check.missingTrustAssets.length;
      if (!priceOk || !sameOps) {
        setConfirmed(null);
        return { changed: t('liquidity:deposit.priceChanged'), fresh };
      }
      if (freshCheck.problems.length) {
        setConfirmed(null);
        return { changed: t('liquidity:dialog.checksChanged'), fresh };
      }
      assertSignerWeight(fresh.account, collected, 'liquidityPoolDeposit');
      if (!alive()) return null;
      const tx = buildDepositTx({ account: fresh.account, pool: fresh.pool, check: freshCheck, quote: c.quote, feePerOp: data.feePerOp, network });
      const res = await send(tx);
      return { hash: res?.hash || res?.id || '' };
    });
  };

  let body;
  if (data.loading && !pool) body = <p className="text-xs">{t('liquidity:dialog.loading')}</p>;
  else if (data.error && !pool) body = <div className={NOTE_ERROR}>{data.error}</div>;
  else if (action.result) body = <ResultNote result={action.result} onClose={onClose} />;
  else if (pool.totalShares === 0n) body = <div className={NOTE_NEUTRAL}>{t('liquidity:deposit.emptyPool')}</div>;
  else {
    const statusText = quote && quote.status !== 'ok' ? t(`liquidity:deposit.status.${quote.status}`) : '';
    body = (
      <>
        <div className={NOTE_WARN} data-testid="deposit-risk">{t('liquidity:deposit.riskNote')}</div>
        {action.notice && <div className={NOTE_WARN} role="alert">{action.notice}</div>}
        <fieldset className="text-xs">
          <legend className="mb-1 font-semibold">{t('liquidity:deposit.inputSide')}</legend>
          <div className="flex gap-4">
            {sides.map((s, index) => (
              <label key={labelOf(s.asset)} className="inline-flex items-center gap-1">
                <input type="radio" name="deposit-side" checked={inputIndex === index} onChange={() => editInput(setInputIndex)(index)} />
                {getAssetCode(s.asset)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold">{t('liquidity:deposit.amount', { asset: labelOf(inputAsset) })}</span>
          <input value={amountInput} onChange={(e) => editInput(setAmountInput)(e.target.value)} className={INPUT} inputMode="decimal" />
        </label>
        {amountInput && amount === null && <div className={NOTE_ERROR}>{t('liquidity:dialog.invalidAmount')}</div>}
        <SlippageField value={slippageInput} onChange={editInput(setSlippageInput)} valid={slippage.valid} />
        <FactList rows={[
          [t('liquidity:deposit.currentPrice', { pair: priceLabel }), currentPrice],
          ...(quote ? sides.map((s) => [t('liquidity:deposit.provide', { asset: labelOf(s.asset) }), formatPoolAmount(amountOf(s.asset), locale)]) : []),
          quote && [t('liquidity:deposit.expectedShares'), formatPoolAmount(quote.expectedShares, locale)],
          quote?.minPrice && quote?.maxPrice && [t('liquidity:deposit.priceBounds', { pair: priceLabel }), `${displayMin(quote)} – ${displayMax(quote)}`],
          check && [t('liquidity:deposit.reserveIncrease'), `${formatPoolAmount(check.reserveIncrease, locale)} XLM`],
          check && [t('liquidity:dialog.fee'), `${formatPoolAmount(check.feeStroops, locale)} XLM`],
        ]} />
        {statusText && <div className={NOTE_NEUTRAL}>{statusText}</div>}
        {check && <CheckInfos infos={check.infos} pool={pool} />}
        {check && <CheckProblems problems={check.problems} pool={pool} />}
        {reviewError && <div className={NOTE_ERROR}>{reviewError}</div>}
        {confirmed ? (
          <>
            <OperationsPreview lines={confirmed.lines} legend={t('liquidity:dialog.legend', { a: labelOf(pool.assetA), b: labelOf(pool.assetB) })} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={handleSign} disabled={action.processing}>{t('liquidity:dialog.sign')}</button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirmed(null)}>{t('liquidity:dialog.back')}</button>
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
    <LiquidityDialogShell title={t('liquidity:deposit.title')} onClose={onClose} closeDisabled={action.processing} testId="deposit-dialog">
      {body}
      {action.showSecretModal && <SecretKeyModal {...action.modalProps} />}
    </LiquidityDialogShell>
  );
}
