// Zeitlimit fuer das Laden und Bauen im Sende-Lock (nicht fuer den POST).
//
// Das SDK setzt fuer GET-Aufrufe (loadAccount, Pools, Claimable Balances, Fee) kein eigenes
// Timeout; nur das Senden hat 60 s. Antwortet Horizon nicht, haelt der Tab den Lock sonst
// beliebig lange, und alle anderen Tabs warten mit. Ein Zeitlimit beendet das mit "nichts
// gesendet" (PreSubmitCheckError): Es wurde noch nichts gesendet und noch kein Eintrag
// geschrieben, der Nutzer kann es erneut versuchen.
import { PreSubmitCheckError } from '../stellar/submitTransactionSafely.js';

// Laden des Kontos, des Pools bzw. der Claimable Balance und der Fee zusammen.
export const LOAD_IN_LOCK_TIMEOUT_MS = 20 * 1000;

export class LoadTimeoutError extends PreSubmitCheckError {
  constructor() {
    super(new Error('loadTimeout'));
    this.name = 'LoadTimeoutError';
    this.message = 'submitTransaction.failed:loadTimeout';
  }
}

/**
 * Fuehrt run({ adjustAccount }) mit Zeitlimit aus. Laeuft das Limit ab, wirft die Funktion
 * LoadTimeoutError; das Ergebnis eines spaeter doch fertigen run wird verworfen, und ein spaeter
 * aufgerufenes adjustAccount wirft ebenfalls (es koennte sonst nach dem Freigeben des Locks noch
 * einen Pin im Speicher veraendern). timeoutMs leer oder 0: kein Limit.
 */
export async function runWithLoadTimeout(run, adjustAccount, timeoutMs) {
  if (!timeoutMs) return run({ adjustAccount });
  let expired = false;
  let timer;
  const guardedAdjust = adjustAccount ? (loaded) => {
    if (expired) throw new LoadTimeoutError();
    return adjustAccount(loaded);
  } : null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new LoadTimeoutError()); }, timeoutMs);
  });
  try {
    return await Promise.race([run({ adjustAccount: guardedAdjust }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
