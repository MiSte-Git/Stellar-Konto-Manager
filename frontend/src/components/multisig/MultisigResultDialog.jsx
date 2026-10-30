import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatValidUntil } from '../../utils/multisig/formatValidUntil.js';

const BTN_OUTLINE = 'px-3 py-1 rounded-sm border border-blue-200 text-blue-700 dark:border-blue-700 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900';
const BTN_SMALL = 'px-2 py-1 rounded-sm border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900';

function shortKey(pk) {
  const val = String(pk || '');
  return val.length <= 16 ? val : `${val.slice(0, 8)}…${val.slice(-8)}`;
}

async function copyText(text, onDone) {
  try {
    await navigator.clipboard.writeText(text || '');
    onDone(true);
    setTimeout(() => onDone(false), 1500);
  } catch (e) {
    console.error('copy failed', e);
  }
}

/**
 * Ergebnis nach einem Multisig-Job, einem XDR-Export oder einer gesendeten
 * Transaktion. Aus SendPaymentPage herausgeloest (gleiche i18n-Keys) und um
 * Signaturstand, fehlende Signer, Frist und "Zum Job" erweitert.
 *
 * @param {{
 *   type: 'job'|'xdr'|'sent',
 *   jobId?: string, hash?: string, xdr?: string,
 *   validUntil?: string|number,          // tx.timeBounds.maxTime (job/xdr), als Frist angezeigt
 *   signing?: { required: number, collected: number, missingSigners: {publicKey:string, weight:number}[] } | null,
 *   summaryItems?: {label:string, value:string}[],   // Zusammenfassung als Liste
 *   children?: React.ReactNode,          // eigene Zusammenfassung (z. B. Liquidity Pools)
 *   notice?: React.ReactNode,            // Zusatzhinweis direkt unter dem Status
 *   explorerLinks?: {href:string, label:string}[],   // nur 'sent'
 *   copyDetailsText?: string,            // nur 'sent': Text fuer "Details kopieren"
 *   onClose: () => void, onBack?: () => void, onSignNow?: () => void, onOpenJob?: () => void,
 * }} props
 */
export default function MultisigResultDialog({
  type,
  jobId,
  hash,
  xdr,
  validUntil,
  signing = null,
  summaryItems = [],
  children,
  notice,
  explorerLinks = [],
  copyDetailsText,
  onClose,
  onBack,
  onSignNow,
  onOpenJob,
}) {
  const { t, i18n } = useTranslation(['multisig', 'common']);
  const [copiedXdr, setCopiedXdr] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);
  const [showJobInfo, setShowJobInfo] = useState(false);
  const hasDeadline = (type === 'job' || type === 'xdr') && validUntil !== undefined && validUntil !== null;
  const unbounded = hasDeadline && (!validUntil || String(validUntil) === '0');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-55 overflow-y-auto p-4" role="dialog" aria-modal="true" data-testid="multisig-result-dialog">
      <div className="bg-white dark:bg-gray-800 rounded-sm p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold">
            {type === 'job' && t('multisig:confirm.result.job.title')}
            {type === 'xdr' && t('multisig:confirm.result.xdr.title')}
            {type === 'sent' && t('multisig:confirm.result.sent.title')}
          </h3>
          <button
            type="button"
            className="p-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            onClick={onClose}
            aria-label={t('common:close')}
          >
            ×
          </button>
        </div>

        {type === 'sent' && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-green-700 dark:text-green-300 mb-3">
            <span>{t('multisig:confirm.result.sent.status')}</span>
            {copyDetailsText !== undefined && (
              <button type="button" className={BTN_SMALL} onClick={() => { void copyText(copyDetailsText, setCopiedDetails); }}>
                {copiedDetails
                  ? t('multisig:confirm.result.sent.copiedDetails', 'Kopiert')
                  : t('multisig:confirm.result.sent.copyDetails', 'Details kopieren')}
              </button>
            )}
          </div>
        )}
        {type === 'job' && (
          <div className="text-sm text-blue-700 dark:text-blue-200 mb-3 space-y-1">
            <div>{t('multisig:confirm.result.job.status')}</div>
            {signing && signing.required > 0 && (
              <div data-testid="multisig-result-progress">
                {t('multisig:confirm.result.job.progress', { collected: signing.collected, required: signing.required })}
              </div>
            )}
          </div>
        )}
        {type === 'xdr' && (
          <div className="text-sm text-amber-700 dark:text-amber-300 mb-3 space-y-1">
            <div>{t('multisig:confirm.result.xdr.status')}</div>
            <div>{t('multisig:confirm.result.xdr.noJob')}</div>
            <div className="text-gray-700 dark:text-gray-200">{t('multisig:confirm.result.xdr.hint')}</div>
          </div>
        )}
        {notice}
        {type === 'job' && (
          <div className="flex justify-end mb-3">
            <button
              type="button"
              className={`${BTN_OUTLINE} text-sm`}
              onClick={() => setShowJobInfo((v) => !v)}
              aria-expanded={showJobInfo}
            >
              {t('multisig:confirm.result.job.infoButton')}
            </button>
          </div>
        )}
        {type === 'job' && showJobInfo && (
          <div className="border rounded-sm p-3 mb-3 bg-blue-50 dark:bg-blue-900/30 text-sm text-gray-800 dark:text-gray-100">
            <div className="font-semibold mb-1">{t('multisig:confirm.result.job.infoTitle')}</div>
            <p className="mb-2 text-gray-700 dark:text-gray-200">{t('multisig:confirm.options.job.desc')}</p>
            <ul className="list-disc ml-5 space-y-1">
              {[
                t('multisig:confirm.options.job.infoBody.one'),
                t('multisig:confirm.options.job.infoBody.two'),
                t('multisig:confirm.options.job.infoBody.three'),
                t('multisig:confirm.options.job.infoBody.four'),
              ].map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {summaryItems.length > 0 && (
          <div className="border rounded-sm p-3 mb-3 space-y-1">
            {summaryItems.map((item, idx) => (
              <div key={idx} className="text-sm flex flex-wrap gap-2">
                <span className="text-gray-600 dark:text-gray-400">{item.label}:</span>
                <span className="font-mono break-all">{item.value}</span>
              </div>
            ))}
          </div>
        )}
        {children && <div className="border rounded-sm p-3 mb-3">{children}</div>}

        {hasDeadline && (
          <p className="text-sm font-medium mb-3" data-testid="multisig-result-deadline">
            {unbounded
              ? t('multisig:confirm.result.deadlineUnbounded')
              : t('multisig:confirm.result.deadline', { date: formatValidUntil(validUntil, i18n.language, t) })}
          </p>
        )}

        {type === 'job' && signing && signing.missingSigners.length > 0 && (
          <div className="border rounded-sm p-3 mb-3 text-sm" data-testid="multisig-result-missing">
            <div className="font-semibold mb-1">{t('multisig:confirm.result.job.missingTitle')}</div>
            <ul className="list-disc ml-5 space-y-0.5">
              {signing.missingSigners.map((s) => (
                <li key={s.publicKey}>
                  <span title={s.publicKey}>{t('multisig:confirm.result.job.missingItem', { signer: shortKey(s.publicKey), weight: s.weight })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(jobId || hash) && (
          <div className="grid gap-2 mb-3">
            {jobId && (
              <div className="flex flex-wrap gap-2 text-sm items-center">
                <span className="text-gray-600 dark:text-gray-400">{t('multisig:confirm.result.job.jobIdLabel')}</span>
                <span className="font-mono break-all">{jobId}</span>
                <button type="button" className={BTN_SMALL} onClick={() => { void copyText(jobId, setCopiedJobId); }}>
                  {copiedJobId ? t('multisig:confirm.result.job.copiedJobId') : t('multisig:confirm.result.job.copyJobId')}
                </button>
              </div>
            )}
            {hash && (
              <div className="flex flex-wrap gap-2 text-sm items-center">
                <span className="text-gray-600 dark:text-gray-400">
                  {type === 'sent'
                    ? t('multisig:confirm.result.sent.hashLabel')
                    : type === 'xdr'
                      ? t('multisig:confirm.result.xdr.hashLabel')
                      : t('multisig:confirm.result.job.hashLabel')}
                </span>
                <span className="font-mono break-all">{hash}</span>
                {type === 'sent' && explorerLinks.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {explorerLinks.map((link) => (
                      <a key={link.href} className={BTN_SMALL} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {type === 'job' && (onSignNow || (onOpenJob && jobId)) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {onSignNow && (
              <button type="button" className={BTN_OUTLINE} onClick={onSignNow}>
                {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
              </button>
            )}
            {onOpenJob && jobId && (
              <button type="button" className={BTN_OUTLINE} onClick={onOpenJob}>
                {t('multisig:confirm.result.job.openJob')}
              </button>
            )}
          </div>
        )}

        {type === 'xdr' && xdr && (
          <div className="border rounded-sm p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-sm text-gray-700 dark:text-gray-300">{t('multisig:prepare.xdrLabel')}</div>
              <button type="button" className={BTN_OUTLINE} onClick={() => { void copyText(xdr, setCopiedXdr); }}>
                {copiedXdr ? t('multisig:prepare.copied', 'Kopiert') : t('multisig:confirm.result.copyXdr')}
              </button>
            </div>
            <textarea
              className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded-sm px-2 py-1"
              readOnly
              value={xdr || ''}
            />
          </div>
        )}

        {type === 'job' && (
          <div className="mt-3 text-sm space-y-1 text-amber-700 dark:text-amber-400">
            <p>{t('multisig:prepare.notSentHint')}</p>
            <p className="text-gray-700 dark:text-gray-300">{t('multisig:prepare.closeHint', 'Du kannst diesen Dialog schließen, sobald Du unterzeichnet hast und der Multisig-Auftrag erstellt wurde; der nächste Signer findet die Job-ID im Menü „Multisig-Jobs“.')}</p>
          </div>
        )}

        {/* Schliessen immer unten rechts, ein optionaler Rueckweg links daneben */}
        <div className="mt-4 flex justify-end gap-2">
          {onBack && (
            <button type="button" className="px-3 py-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onBack}>
              {t('common:option.back', 'Zurück')}
            </button>
          )}
          <button type="button" className="px-4 py-2 rounded-sm bg-blue-600 text-white hover:bg-blue-700" onClick={onClose}>
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>
  );
}
