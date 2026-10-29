import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAssetLabelWithIssuer } from '../trading/assetSearchUtils.js';
import { BTN_SECONDARY, INPUT, NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN } from './LiquidityDialogShell.jsx';

export function SlippageField({ value, onChange, valid }) {
  const { t } = useTranslation(['liquidity']);
  return (
    <>
      <label className="block text-xs">
        <span className="mb-1 block font-semibold">{t('liquidity:dialog.slippage')}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} max-w-[8rem]`} inputMode="decimal" />
      </label>
      {!valid && <div className={NOTE_ERROR}>{t('liquidity:dialog.slippageRange')}</div>}
    </>
  );
}

/** Fakten aus den Vorpruefungen (checkDepositPreconditions/checkWithdrawPreconditions). */
export function CheckProblems({ problems, pool }) {
  const { t } = useTranslation(['liquidity']);
  if (!problems?.length) return null;
  const assetFor = (side) => (side === 'B' ? pool.assetB : pool.assetA);
  return (
    <ul className={`${NOTE_ERROR} list-disc pl-6`} data-testid="liquidity-problems">
      {problems.map((p) => (
        <li key={`${p.code}-${p.side || ''}`}>
          {t(`liquidity:checks.${p.code}`, { asset: p.side ? formatAssetLabelWithIssuer(assetFor(p.side)) : '' })}
        </li>
      ))}
    </ul>
  );
}

/** Hinweise aus den Vorpruefungen, die nicht sperren (z. B. Clawback aktiv). */
export function CheckInfos({ infos, pool }) {
  const { t } = useTranslation(['liquidity']);
  if (!infos?.length) return null;
  const assetFor = (side) => (side === 'B' ? pool.assetB : pool.assetA);
  return (
    <ul className={`${NOTE_NEUTRAL} list-disc pl-6`} data-testid="liquidity-infos">
      {infos.map((info) => (
        <li key={`${info.code}-${info.side || ''}`}>
          {t(`liquidity:checks.${info.code}`, { asset: info.side ? formatAssetLabelWithIssuer(assetFor(info.side)) : '' })}
        </li>
      ))}
    </ul>
  );
}

export function ResultNote({ result, onClose }) {
  const { t } = useTranslation(['liquidity']);
  return (
    <>
      {result.ambiguousHash !== undefined ? (
        <div className={NOTE_WARN} role="alert" data-testid="liquidity-ambiguous">
          <div className="font-semibold">{t('liquidity:dialog.ambiguousTitle')}</div>
          <div>{t('liquidity:dialog.ambiguousBody')}</div>
          {result.ambiguousHash && <div className="mt-1 break-all font-mono">{result.ambiguousHash}</div>}
        </div>
      ) : (
        <div className={NOTE_NEUTRAL} role="status" data-testid="liquidity-success">
          <div className="font-semibold">{t('liquidity:dialog.success')}</div>
          {result.hash && <div className="mt-1 break-all font-mono">{result.hash}</div>}
        </div>
      )}
      <button type="button" className={BTN_SECONDARY} onClick={onClose}>{t('liquidity:dialog.close')}</button>
    </>
  );
}
