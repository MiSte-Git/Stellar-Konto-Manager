// Unklarer Sendestatus auf "Zahlung senden": Ursache, Uhrzeit des Sendens, Countdown bis zur
// sicheren Klaerung, "Status jetzt pruefen", "Erneut senden" (nur dieselbe signierte
// Transaktion) und "Details kopieren". Aufbau und Farben wie in der Sammelzahlung.
import React, { useState } from 'react';
import { ambiguousClearAt } from '../../utils/submitGuard/ambiguousResolve.js';
import { copyText } from '../../utils/clipboard.js';
import { AmbiguousStatus } from '../AmbiguousSubmitStatus.jsx';
import { diagnosticsLines, formatClearTime, safeDiagText } from '../../utils/submitGuard/ambiguousDisplay.js';

const smallBtnCls = 'px-2 py-1 rounded-sm border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900 text-xs disabled:opacity-50';
const K = 'common:payment.send.ambiguousResult';
const STATUS_TEXTS = {
  countdown: `${K}.countdown`,
  unreadable: `${K}.unreadable`,
};
const BATCH_UNREADABLE_TEXTS = { ...STATUS_TEXTS, unreadable: `${K}.unreadableBatch` };

// Haupttext je Zustand: Sammelzahlung, unlesbarer Eintrag der Sammelzahlung, frueher als nicht
// ausgefuehrt gefuehrt und erneut zu pruefen, gesendet ohne Bestaetigung (mit Ursache) oder
// moeglicherweise gesendet (ohne Ursache: unterbrochen oder in einem anderen Tab).
function bodyText(block, t) {
  const entry = block.entry || {};
  if (block.kind === 'batchUnreadable') return t(`${K}.batchUnreadableBody`);
  if (block.kind === 'batch') return t(`${K}.batchBody`);
  if (entry.recheck) return t(`${K}.bodyRecheck.${entry.recheck}`);
  if (entry.cause && !entry.unreadable) return t(`${K}.bodyBlocked`);
  return t(`${K}.bodyMaybe`);
}

function causeText(entry, t) {
  const cause = entry?.cause;
  if (cause?.kind === 'network') return t(`${K}.cause.network`);
  if (cause?.kind === 'timeout') return t(`${K}.cause.timeout`);
  if (cause?.kind === 'server') return t(`${K}.cause.server`, { status: cause.status || '?' });
  return t(`${K}.cause.unknown`);
}

function formatTime(ms, language) {
  try { return new Date(ms).toLocaleString(language || undefined); } catch { return new Date(ms).toISOString(); }
}

/**
 * guard: Ergebnis von useAccountSendBlock. networkLabel: Anzeige des Netzes.
 * explorerLinks(hash): [{ href, label }].
 */
export default function SendAmbiguousPanel({ guard, t, language, networkLabel, explorerLinks }) {
  const [copied, setCopied] = useState(false);
  const { block } = guard;
  // Eigener Submit laeuft gerade in diesem Tab: noch nicht unklar, Senden bleibt gesperrt.
  if (!block || block.sending) return null;
  const entry = block.entry || {};
  const isBatch = block.kind === 'batch' || block.kind === 'batchUnreadable';
  const showCause = !isBatch && !entry.unreadable && !entry.recheck;
  const summary = entry.summary || null;
  const paymentLine = summary?.recipient
    ? t(`${K}.payment`, { amount: summary.amountDisplay || '?', asset: summary.asset || '', recipient: summary.recipient })
    : '';
  const sentAt = Number(entry.at) > 0 ? formatTime(entry.at, language) : '';
  const links = entry.hash ? explorerLinks(entry.hash) : [];

  const detailsText = () => [
    t(`${K}.title`),
    bodyText(block, t),
    showCause ? causeText(entry, t) : '',
    sentAt ? t(`${K}.sentAt`, { time: sentAt }) : '',
    paymentLine ? safeDiagText(paymentLine) : '',
    entry.hash ? `TX: ${entry.hash}` : '',
    entry.seq ? `Sequence: ${entry.seq}` : '',
    `${t('common:networkLabel', 'Netzwerk')}: ${networkLabel}`,
    ambiguousClearAt(entry) ? t('batchPayment:ambiguous.clearAt', { time: formatClearTime(ambiguousClearAt(entry)) }) : '',
    ...diagnosticsLines(guard.diagnostics, t),
  ].filter(Boolean).join('\n');

  const onCopy = async () => {
    try {
      await copyText(detailsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  return (
    <div className="text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-sm p-3 max-w-4xl mx-auto space-y-1" role="alert" data-testid="send-ambiguous">
      <div className="font-semibold">{t(`${K}.title`)}</div>
      <div data-testid="send-ambiguous-body">{bodyText(block, t)}</div>
      {showCause && <div data-testid="send-ambiguous-cause">{causeText(entry, t)}</div>}
      {block.missing && <div className="text-xs">{t(`${K}.missing`)}</div>}
      {sentAt && <div className="text-xs" data-testid="send-ambiguous-sent-at">{t(`${K}.sentAt`, { time: sentAt })}</div>}
      {paymentLine && <div className="text-xs break-all">{paymentLine}</div>}
      {entry.hash && (
        <div className="text-xs">
          <span className="text-gray-600 dark:text-gray-400">TX:</span> <span className="font-mono break-all" data-testid="send-ambiguous-hash">{entry.hash}</span>
          {links.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-2">
              {links.map((l) => <a key={l.href} className={smallBtnCls} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
            </span>
          )}
        </div>
      )}
      <div className="text-xs" data-testid="send-ambiguous-network">{t('common:networkLabel', 'Netzwerk')}: {networkLabel}</div>
      <AmbiguousStatus
        entry={entry}
        check={guard.check}
        onCheck={guard.checkNow}
        t={t}
        texts={block.kind === 'batchUnreadable' ? BATCH_UNREADABLE_TEXTS : STATUS_TEXTS}
        testIdPrefix="send"
        unreadableCheck
      />
      {!isBatch && !entry.unreadable && (
        <div className="space-y-1 pt-1">
          {guard.resendAvailable && (
            <>
              <button type="button" className={smallBtnCls} onClick={guard.resendNow} disabled={!!guard.resend?.busy || guard.check?.state === 'checking'} data-testid="send-ambiguous-resend">
                {guard.resend?.busy ? t(`${K}.resendBusy`) : t(`${K}.resend`)}
              </button>
              <div className="text-xs text-gray-600 dark:text-gray-400">{t(`${K}.resendHint`)}</div>
            </>
          )}
          {guard.resendMissing && (
            <div className="text-xs text-gray-600 dark:text-gray-400" data-testid="send-ambiguous-resend-missing">{t(`${K}.resendUnavailable`)}</div>
          )}
          {guard.resend?.ambiguous && <div className="text-xs text-amber-700 dark:text-amber-300">{t(`${K}.resendAmbiguous`)}</div>}
          {guard.resend?.rejected && (
            <div className="text-xs text-amber-700 dark:text-amber-300" data-testid="send-ambiguous-resend-rejected">
              {t(`${K}.resendRejected`, { detail: safeDiagText(guard.resend.error || '?') })}
            </div>
          )}
        </div>
      )}
      <div className="pt-1">
        <button type="button" className={smallBtnCls} onClick={onCopy} data-testid="send-ambiguous-copy">
          {copied ? t('batchPayment:actions.copied') : t('batchPayment:actions.copyDetails')}
        </button>
      </div>
    </div>
  );
}

// Ergebnis einer Klaerung ueber Horizon (angewendet oder nicht ausgefuehrt).
export function SendResolvedNotice({ notice, t, onDismiss }) {
  if (!notice) return null;
  let text;
  if (notice.kind === 'applied') {
    text = notice.origin === 'batch' ? t(`${K}.resolvedAppliedBatch`) : t(`${K}.resolvedApplied`);
  } else if (notice.unreadable && notice.outcome === 'failed') {
    text = t(`${K}.resolvedUnreadableFailed`);
  } else if (notice.unreadable) {
    text = notice.origin === 'batch' ? t(`${K}.resolvedUnreadableBatch`) : t(`${K}.resolvedUnreadable`);
  } else {
    text = notice.origin === 'batch' ? t(`${K}.resolvedNotAppliedBatch`) : t(`${K}.resolvedNotApplied`);
  }
  return (
    <div role="status" data-testid="send-ambiguous-resolved" data-kind={notice.kind} className="text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-300/60 text-amber-900 dark:text-amber-100 rounded-sm p-3 max-w-4xl mx-auto">
      <div>{text}</div>
      {notice.kind === 'notApplied' && notice.pinned && <div className="text-xs mt-1">{t(`${K}.resolvedPinned`)}</div>}
      <button type="button" className="mt-1 underline text-xs" onClick={onDismiss}>{t('common:close', 'Schliessen')}</button>
    </div>
  );
}
