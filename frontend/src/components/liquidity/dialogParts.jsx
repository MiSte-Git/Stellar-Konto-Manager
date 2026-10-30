import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../utils/useSettings.js';
import { buildExplorerUrl } from '../../utils/stellar/accountUtils.js';
import { safeHttpUrl } from '../../utils/stellar/activity.js';
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

/**
 * Fakten aus den Vorpruefungen (checkDepositPreconditions/checkWithdrawPreconditions).
 * Mit onAddTrustline(asset) erscheint bei fehlender Asset-Trustline ein Button dazu.
 */
export function CheckProblems({ problems, pool, onAddTrustline }) {
  const { t } = useTranslation(['liquidity']);
  if (!problems?.length) return null;
  const assetFor = (side) => (side === 'B' ? pool.assetB : pool.assetA);
  return (
    <ul className={`${NOTE_ERROR} list-disc pl-6`} data-testid="liquidity-problems">
      {problems.map((p) => (
        <li key={`${p.code}-${p.side || ''}`}>
          {t(`liquidity:checks.${p.code}`, { asset: p.side ? formatAssetLabelWithIssuer(assetFor(p.side)) : '' })}
          {onAddTrustline && p.code === 'missingTrustNoBalance' && (
            <>
              {' '}
              <button type="button" className="font-semibold underline hover:no-underline" onClick={() => onAddTrustline(assetFor(p.side))}>
                {t('liquidity:checks.addTrustline', { asset: formatAssetLabelWithIssuer(assetFor(p.side)) })}
              </button>
            </>
          )}
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

/** Explorer-Links zum Hash; Eintraege ohne gueltige https-Vorlage entfallen. */
function ExplorerLinks({ hash, network }) {
  const { t } = useTranslation(['common']);
  const { explorers } = useSettings();
  const urlFor = (key) => safeHttpUrl(buildExplorerUrl((explorers || []).find((e) => (e.key || e.id) === key), hash, network, { type: 'tx' }));
  const links = [
    { href: urlFor('stellar_expert'), label: t('common:balance.explorer.expert') },
    { href: urlFor('stellarchain'), label: t('common:balance.explorer.stellarchain') },
  ].filter((link) => link.href);
  if (!links.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-3">
      {links.map((link) => (
        <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:no-underline dark:text-blue-300">
          {link.label}
        </a>
      ))}
    </div>
  );
}

export function ResultNote({ result, network, onClose }) {
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
          {result.hash && <ExplorerLinks hash={result.hash} network={network} />}
        </div>
      )}
      <button type="button" className={BTN_SECONDARY} onClick={onClose}>{t('liquidity:dialog.close')}</button>
    </>
  );
}
