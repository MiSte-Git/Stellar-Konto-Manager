'use strict';

// F-2: Unklares Sendeergebnis eines Multisig-Jobs. Kommt beim Senden keine eindeutige Antwort von
// Horizon, kann die Transaktion trotzdem im Ledger landen. Der Job wird dann nicht submitted_failed
// (Endzustand, die Signer legen dieselbe Zahlung neu an und sie geht doppelt raus), sondern
// submit_unclear: nicht final, aber gesperrt (kein Merge, kein Ablehnen, kein Loeschen, nie erneutes
// Senden). Geklaert wird beim Lesen ueber GET /transactions/{hash}, sobald das Ergebnis feststehen
// kann: Sequence der Tx-Quelle verbraucht oder maxTime laut Serveruhr vorbei. Ob ein 404 endgueltig ist,
// entscheidet die Ledger-Zeit von Horizon (R-1), nie die Serveruhr. Gleiche Regeln und Konstanten wie
// api/submitUnclear.php.

const { submitSuccessResult } = require('./submitResult.js');

const SUBMIT_UNCLEAR_STATUS = 'submit_unclear';
// R-1: Ein 404 ist erst endgueltig, wenn die Ledger-Zeit aus GET / mehr als so viele Sekunden nach maxTime
// liegt. Root und Transaktion sind zwei Anfragen und koennen hinter dem Load Balancer verschiedene Knoten
// treffen; mit der Marge muesste der Knoten der Transaktionsabfrage ueber 60 s zurueckliegen statt nur einen
// Ledger. Gleiche Marge wie der strenge Pfad im Sendeschutz des Frontends (maxTime plus 60 s).
const SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS = 60;
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

/**
 * Wird jetzt abgefragt? Bei verbrauchter Sequence oder wenn maxTime laut Serveruhr vorbei ist (maxTime 0:
 * ohne Zeitgrenze, nie). Die Serveruhr bestimmt nur, wann gefragt wird; endgueltig macht einen 404 nur
 * die Ledger-Zeit (isLedgerPastMaxTime). Geht die Uhr nach, wird spaeter gefragt, geht sie vor, umsonst.
 */
function isUnclearResolveDue({ sequenceConsumed, maxTimeUnix, nowUnix }) {
  const maxTime = Number(maxTimeUnix || 0);
  return sequenceConsumed || (maxTime > 0 && nowUnix > maxTime);
}

/**
 * history_latest_ledger_closed_at aus GET / als Unix-Sekunden, sonst null. Horizon liefert UTC mit Z
 * (2026-11-15T10:00:00Z). Nur diese Form; ein unmoegliches Datum (30. Februar, Stunde 99) ergibt null,
 * gleich wie skm_parse_ledger_closed_at in PHP (Date.parse wuerde es weiterrollen).
 */
function parseLedgerClosedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return Math.floor(ms / 1000);
}

/**
 * R-1: Hat Horizon einen Ledger aufgenommen, der mehr als SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS nach maxTime
 * geschlossen wurde? Eine Transaktion kann nur in einen Ledger mit Schliesszeit <= maxTime; liegt der zuletzt
 * aufgenommene danach, sind alle Ledger bis maxTime aufgenommen und ein 404 ist endgueltig. Die Marge deckt
 * einen anderen, nachhinkenden Knoten fuer die Transaktionsabfrage ab. Ohne Ledger-Zeit oder Zeitgrenze: nie.
 */
function isLedgerPastMaxTime(maxTimeUnix, ledgerClosedAtUnix) {
  const maxTime = Number(maxTimeUnix || 0);
  return maxTime > 0 && Number.isFinite(ledgerClosedAtUnix)
    && ledgerClosedAtUnix > maxTime + SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS;
}

/**
 * Ergebnis aus dem Abruf der Transaktion.
 * @param {{ kind: 'found', successful?: boolean, hash?: string, ledger?: number } | { kind: 'not_found' } | { kind: 'error' }} lookup
 * Gefunden ist sofort endgueltig. Ein 404 erst, wenn Horizon einen Ledger mehr als 60 s nach maxTime meldet: Ein Knoten
 * kann hinterherhinken (auch mehr als Minuten), dann zeigt er weder die Transaktion noch die verbrauchte
 * Sequence. Vorher hiesse expired/obsolete_seq bei einem ausgefuehrten Job, dass die Signer ihn neu anlegen.
 * @param {boolean} sequenceConsumed
 * @param {boolean} ledgerPastMaxTime isLedgerPastMaxTime(maxTime, history_latest_ledger_closed_at)
 * @returns {{ status: string, submittedResult?: object } | null} null: bleibt unklar. Ohne submittedResult
 *   bleibt das gespeicherte (der Fehlertext vom Senden).
 */
function unclearOutcome(lookup, sequenceConsumed, ledgerPastMaxTime) {
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
    if (ledgerPastMaxTime !== true) return null;
    return { status: sequenceConsumed ? 'obsolete_seq' : 'expired' };
  }
  return null;
}

module.exports = {
  SUBMIT_UNCLEAR_STATUS,
  SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST,
  SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS,
  isUnclearSubmitError,
  isUnclearSubmitSuccess,
  isSequenceConsumed,
  isUnclearResolveDue,
  parseLedgerClosedAt,
  isLedgerPastMaxTime,
  unclearOutcome,
};
