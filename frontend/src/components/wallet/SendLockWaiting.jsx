// Hinweis "wartet auf einen anderen Sendevorgang" mit Abbrechen, gemeinsam fuer die Sendewege
// ohne eigene Seite fuer diesen Zustand (Liquidity, Claimable Balances, Sammel-Tausch). Der Text
// ist derselbe wie in "Zahlung senden". Abbrechen beendet nur das Warten: Danach wird nichts
// gesendet.
import React from 'react';
import { useTranslation } from 'react-i18next';

export default function SendLockWaiting({ waiting, onCancel }) {
  const { t } = useTranslation(['common', 'batchPayment']);
  if (!waiting) return null;
  return (
    <div className="text-xs text-amber-700 dark:text-amber-300" role="status" data-testid="send-lock-waiting">
      {t('common:payment.send.ambiguousResult.waitingForLock')}
      {onCancel && (
        <button type="button" className="ml-2 underline" onClick={onCancel} data-testid="send-lock-waiting-cancel">
          {t('batchPayment:actions.cancelWaiting')}
        </button>
      )}
    </div>
  );
}
