// Anzeige eines unklaren Sendestatus, gemeinsam fuer Sammelzahlung und "Zahlung senden":
// Countdown bis zur automatischen Pruefung (Amber-Kasten), Uhrzeit, ab der der Status
// eindeutig werden kann, und "Status jetzt pruefen". Hilfsfunktionen (Zeiten, Diagnose)
// in utils/submitGuard/ambiguousDisplay.js.
import React, { useEffect, useState } from 'react';
import { ambiguousClearAt } from '../utils/submitGuard/ambiguousResolve.js';
import { AMBER_BOX_CLS, autoCheckDue, formatClearTime, formatCountdown } from '../utils/submitGuard/ambiguousDisplay.js';

const smallBtnCls = 'px-2 py-1 rounded-sm border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900 text-xs';

// Texte der Sammelzahlung; andere Sendewege ersetzen einzelne Schluessel ueber `texts`.
const DEFAULT_TEXTS = {
  checking: 'batchPayment:ambiguous.checking',
  countdown: 'batchPayment:ambiguous.countdown',
  clearAtUnknown: 'batchPayment:ambiguous.clearAtUnknown',
  stillPending: 'batchPayment:ambiguous.stillPending',
  unreachable: 'batchPayment:ambiguous.unreachable',
  clearAt: 'batchPayment:ambiguous.clearAt',
  unreadable: 'batchPayment:ambiguous.unreadable',
  checkNow: 'batchPayment:actions.checkStatusNow',
  checkingNow: 'batchPayment:actions.checkingStatus',
};

/**
 * Unklarer Status: Countdown bis zur automatischen Pruefung (Amber-Kasten), darunter klein
 * die Uhrzeit, ab der der Status eindeutig werden kann, und "Status jetzt pruefen".
 * check: { state, at } der letzten Pruefung (at = Beginn der Horizon-Abfrage).
 * unreadableCheck: auch bei unlesbarem Eintrag "Status jetzt pruefen" anbieten (der
 * Sendeweg kann ihn ueber Horizon klaeren); sonst bleibt er ohne Button gesperrt.
 */
export function AmbiguousStatus({ entry, check, onCheck, t, texts = null, testIdPrefix = 'batch', unreadableCheck = false }) {
  const tx = { ...DEFAULT_TEXTS, ...(texts || {}) };
  const clearAt = ambiguousClearAt(entry);
  const due = autoCheckDue(entry);
  const [now, setNow] = useState(() => Date.now());
  const checking = check?.state === 'checking';
  const ticking = !!due && now < due;
  useEffect(() => {
    if (!due) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [due]);
  // Ergebnis einer Pruefung nach dem Zeitpunkt (automatisch, beim Pruefen der Liste oder per Button)
  const checkedAfterDue = !!due && Number(check?.at) >= due && !checking;
  let main;
  if (checking) main = t(tx.checking);
  else if (ticking) main = t(tx.countdown, { time: formatCountdown(due - now) });
  else if (!due) main = t(tx.clearAtUnknown);
  else if (checkedAfterDue && check.state === 'pending') main = t(tx.stillPending, { time: formatClearTime(clearAt) });
  else if (checkedAfterDue && check.state === 'unknown') main = t(tx.unreachable);
  else main = t(tx.checking);
  // Ergebnis einer Pruefung per Button vor dem Zeitpunkt: klein unter dem Countdown.
  const earlyResult = ticking && !checking && check && Number(check.at) < due ? check.state : '';
  const button = (
    <button type="button" className={smallBtnCls} onClick={onCheck} disabled={checking} data-testid={`${testIdPrefix}-ambiguous-check`}>
      {checking ? t(tx.checkingNow) : t(tx.checkNow)}
    </button>
  );
  // Unlesbarer Eintrag: kein Hash bekannt. Bleibt gesperrt, bis der Sendeweg ihn ueber
  // Horizon klaert (unreadableCheck) oder ohne Ausweg.
  if (entry?.unreadable) {
    const result = !checking && check?.state === 'unknown' ? t(tx.unreachable) : '';
    return (
      <div className="mt-1 space-y-1 text-xs" data-testid={`${testIdPrefix}-ambiguous-status`}>
        <div className={AMBER_BOX_CLS} role="status" data-testid={`${testIdPrefix}-ambiguous-unreadable`}>
          {checking ? t(tx.checking) : t(tx.unreadable)}
        </div>
        {unreadableCheck && result && <div className="text-amber-700 dark:text-amber-300">{result}</div>}
        {unreadableCheck && !checking && check?.state === 'pending' && check.clearAt && (
          <div className="text-amber-700 dark:text-amber-300">{t(tx.stillPending, { time: formatClearTime(check.clearAt) })}</div>
        )}
        {unreadableCheck && button}
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid={`${testIdPrefix}-ambiguous-status`}>
      <div className={AMBER_BOX_CLS} role="status" data-testid={`${testIdPrefix}-ambiguous-countdown`}>
        {main}
      </div>
      {clearAt && (
        <div className="text-gray-600 dark:text-gray-400" data-testid={`${testIdPrefix}-ambiguous-clear-at`}>
          {t(tx.clearAt, { time: formatClearTime(clearAt) })}
        </div>
      )}
      {earlyResult === 'pending' && (
        <div className="text-amber-700 dark:text-amber-300">{t(tx.stillPending, { time: formatClearTime(clearAt) })}</div>
      )}
      {earlyResult === 'unknown' && (
        <div className="text-amber-700 dark:text-amber-300">{t(tx.unreachable)}</div>
      )}
      {button}
    </div>
  );
}

