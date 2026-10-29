import React from 'react';
import { useTranslation } from 'react-i18next';

export const BTN_PRIMARY = 'rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
export const BTN_SECONDARY = 'rounded-sm border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
export const NOTE_NEUTRAL = 'rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
export const NOTE_WARN = 'rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100';
export const NOTE_ERROR = 'rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200';
export const INPUT = 'w-full rounded-sm border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900';

/** Rahmen fuer Einzahlen/Abheben (unter dem SecretKeyModal, das ebenfalls z-50 nutzt und spaeter gerendert wird). */
export default function LiquidityDialogShell({ title, onClose, closeDisabled = false, children, testId }) {
  const { t } = useTranslation(['liquidity']);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="w-full max-w-xl rounded-sm bg-white p-4 text-left shadow-lg dark:bg-gray-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} disabled={closeDisabled} className="text-sm text-gray-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300">
            {t('liquidity:dialog.close')}
          </button>
        </div>
        <div className="space-y-3 text-sm">{children}</div>
      </div>
    </div>
  );
}

/**
 * Eine Faktenzeile: Label links (optional mit kleiner Erklaerung darunter), Wert
 * rechts. Auf schmalen Breiten steht das Label oben und der Wert darunter.
 * Werte brechen nicht innerhalb von Zahlen um; nur mit wrap (lange IDs und
 * Adressen) ist break-all erlaubt.
 */
export function FactRow({ label, hint, value, wrap = false, className = '' }) {
  return (
    <div className={`flex flex-col gap-0.5 py-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 ${className}`}>
      <dt className="min-w-0">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-[11px] font-normal text-gray-600 dark:text-gray-400">{hint}</span>}
      </dt>
      <dd className={`font-mono sm:text-right ${wrap ? 'min-w-0 break-all' : 'sm:whitespace-nowrap'}`}>{value}</dd>
    </div>
  );
}

/** Liste von Faktenzeilen: [label, value, { hint, wrap }?]; falsy Eintraege werden ausgelassen. */
export function FactList({ rows }) {
  return (
    <dl className="text-xs">
      {rows.filter(Boolean).map(([label, value, opts = {}], index) => (
        <FactRow key={`${index}-${label}`} label={label} value={value} hint={opts.hint} wrap={opts.wrap} />
      ))}
    </dl>
  );
}

/** Operationen im Klartext (describeOperations) vor dem Signieren. */
export function OperationsPreview({ lines, legend }) {
  const { t } = useTranslation(['liquidity']);
  return (
    <div className={NOTE_NEUTRAL} data-testid="liquidity-ops">
      <div className="mb-1 font-semibold">{t('liquidity:dialog.operations')}</div>
      <ol className="list-decimal pl-4">
        {lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ol>
      {legend && <div className="mt-1">{legend}</div>}
    </div>
  );
}
