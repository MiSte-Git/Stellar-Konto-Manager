'use strict';

// F-2: Unklares Sendeergebnis eines Multisig-Jobs. Kommt beim Senden keine eindeutige Antwort von
// Horizon, kann die Transaktion trotzdem im Ledger landen. Der Job wird dann nicht submitted_failed
// (Endzustand, die Signer legen dieselbe Zahlung neu an und sie geht doppelt raus), sondern
// submit_unclear: nicht final, aber gesperrt (kein Merge, kein Ablehnen, kein Loeschen, nie erneutes
// Senden). Geklaert wird beim Lesen ueber GET /transactions/{hash}, sobald das Ergebnis feststehen
// muss: Sequence der Tx-Quelle verbraucht oder maxTime + SUBMIT_UNCLEAR_GRACE_SECONDS vorbei.
// Gleiche Regeln und Konstanten wie api/submitUnclear.php.

const { submitSuccessResult } = require('./submitResult.js');

const SUBMIT_UNCLEAR_STATUS = 'submit_unclear';
// Karenz nach maxTime: Horizon kann dem Ledger einige Sekunden hinterherhinken, und die Uhr des
// Servers muss nicht genau mit der Schliesszeit der Ledger uebereinstimmen.
const SUBMIT_UNCLEAR_GRACE_SECONDS = 120;
// Hoechstens so viele Abfragen GET /transactions/{hash} je Lese-Anfrage (Liste oder Detail).
const SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST = 5;
// Fehlertext, wenn die Transaktion im Ledger steht, aber fehlgeschlagen ist (Horizon liefert im
// Datensatz keine result_codes).
const SUBMIT_UNCLEAR_FAILED_MESSAGE = 'Transaction Failed';

function hasResultCodes(codes) {
  if (!codes || typeof codes !== 'object' || Array.isArray(codes)) return false;
  return typeof codes.transaction === 'string'
    || typeof codes.inner_transaction === 'string'
    || (Array.isArray(codes.operations) && codes.operations.some((c) => typeof c === 'string'));
}

/**
 * Fehler aus Horizon.Server#submitTransaction (oder dem eigenen Timeout): unklar sind keine Antwort
 * (Netzfehler, Timeout), 408, 429 und >= 500, jeweils ohne result_codes. Mit result_codes und bei
 * jedem anderen Status ist es eine Ablehnung.
 */
function isUnclearSubmitError(err) {
  const response = err?.response;
  if (hasResultCodes(response?.data?.extras?.result_codes)) return false;
  const status = response?.status;
  if (typeof status !== 'number') return true;
  return status === 408 || status === 429 || status >= 500;
}

/** 2xx ohne Hash ist unklar: Horizon hat geantwortet, sagt aber nicht, was passiert ist. */
function isUnclearSubmitSuccess(result) {
  return !(typeof result?.hash === 'string' && result.hash !== '');
}

/** Konto-Sequence >= Tx-Sequence. Unbekannte oder kaputte Werte: nicht verbraucht. */
function isSequenceConsumed(txSequence, accountSequence) {
  if (accountSequence === null || accountSequence === undefined) return false;
  try {
    return BigInt(accountSequence) >= BigInt(txSequence);
  } catch {
    return false;
  }
}

/** Ist jetzt > maxTime + Karenz? maxTimeUnix 0 heisst ohne Zeitgrenze: nie vorbei. */
function isUnclearTimePassed(maxTimeUnix, nowUnix) {
  const maxTime = Number(maxTimeUnix || 0);
  return maxTime > 0 && nowUnix > maxTime + SUBMIT_UNCLEAR_GRACE_SECONDS;
}

/** Darf jetzt abgefragt werden? Bei verbrauchter Sequence oder abgelaufener Zeit (plus Karenz). */
function isUnclearResolveDue({ sequenceConsumed, maxTimeUnix, nowUnix }) {
  return sequenceConsumed || isUnclearTimePassed(maxTimeUnix, nowUnix);
}

/**
 * Ergebnis aus dem Abruf der Transaktion.
 * @param {{ kind: 'found', successful?: boolean, hash?: string, ledger?: number } | { kind: 'not_found' } | { kind: 'error' }} lookup
 * Gefunden ist sofort endgueltig. Ein 404 erst nach maxTime + Karenz: Horizon laeuft hinter einem Load
 * Balancer, das Konto (Sequence verbraucht) kann vom aktuellen Knoten kommen und der 404 von einem
 * nachhinkenden. Vorher hiesse obsolete_seq bei einem ausgefuehrten Job, dass die Signer ihn neu anlegen.
 * @param {boolean} sequenceConsumed
 * @param {boolean} timePassed jetzt > maxTime + SUBMIT_UNCLEAR_GRACE_SECONDS
 * @returns {{ status: string, submittedResult?: object } | null} null: bleibt unklar. Ohne submittedResult
 *   bleibt das gespeicherte (der Fehlertext vom Senden).
 */
function unclearOutcome(lookup, sequenceConsumed, timePassed) {
  if (lookup?.kind === 'found') {
    if (lookup.successful === true) {
      return { status: 'submitted_success', submittedResult: submitSuccessResult({ hash: lookup.hash, ledger: lookup.ledger }) };
    }
    if (lookup.successful === false) {
      const message = SUBMIT_UNCLEAR_FAILED_MESSAGE;
      return { status: 'submitted_failed', submittedResult: { error: message, detail: { message, extras: {} } } };
    }
    return null;
  }
  if (lookup?.kind === 'not_found') {
    if (timePassed !== true) return null;
    return { status: sequenceConsumed ? 'obsolete_seq' : 'expired' };
  }
  return null;
}

module.exports = {
  SUBMIT_UNCLEAR_STATUS,
  SUBMIT_UNCLEAR_GRACE_SECONDS,
  SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST,
  isUnclearSubmitError,
  isUnclearSubmitSuccess,
  isSequenceConsumed,
  isUnclearTimePassed,
  isUnclearResolveDue,
  unclearOutcome,
};
