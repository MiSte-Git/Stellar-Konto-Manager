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

// R-6: Eine Ablehnung braucht echte Codes: transaction oder inner_transaction als String oder mindestens einen
// String in operations. Gleiche Regel wie skm_has_result_codes in api/submitUnclear.php, gemeinsame Faelle in
// test/assets/submit-classification.json.
function hasResultCodes(codes) {
  if (!codes || typeof codes !== 'object' || Array.isArray(codes)) return false;
  return typeof codes.transaction === 'string'
    || typeof codes.inner_transaction === 'string'
    || (Array.isArray(codes.operations) && codes.operations.some((c) => typeof c === 'string'));
}

/**
 * Fehler aus Horizon.Server#submitTransaction (oder dem eigenen Timeout): unklar sind keine Antwort
 * (Netzfehler, Timeout, Status fehlt oder 0), 408, 429 und >= 500, jeweils ohne result_codes. Mit
 * result_codes und bei jedem anderen Status ist es eine Ablehnung.
 */
function isUnclearSubmitError(err) {
  const response = err?.response;
  if (hasResultCodes(response?.data?.extras?.result_codes)) return false;
  const status = response?.status;
  if (typeof status !== 'number' || status === 0) return true;
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

// ADR 0014: Klaerung extern gesendeter Jobs ueber den txHash. SKM sendet nur ueber den Write-ahead
// submit_unclear (R-3); steht ein Job mit einem dieser gespeicherten Status im Ledger, hat ihn jemand
// ausserhalb von SKM gesendet. Offene Jobs und die Endzustaende, die SKM ohne Blick ins Ledger setzt
// (Waechter, Merge, Ablehnen). submitted_success und submitted_failed nie. Gleich wie api/submitUnclear.php.
const EXTERNAL_CHECK_STATUSES = new Set(['pending_signatures', 'ready_to_submit', 'expired', 'obsolete_seq', 'rejected']);
// Endzustaende, die ein sicherer 404 stehen laesst (es kommt nur ledgerCheckedAt dazu). expired nicht: Kandidaten haben
// eine verbrauchte Sequence, und ein Widerruf (bumpSequence) ergibt obsolete_seq, auch wenn der Waechter (Serveruhr)
// den Job vorher bei maxTime auf expired gesetzt hat (ES-6).
const EXTERNAL_CHECK_FINAL_STATUSES = new Set(['obsolete_seq', 'rejected']);

/**
 * Wird der gespeicherte Job auf ein externes Senden geprueft? Status aus EXTERNAL_CHECK_STATUSES, noch ohne
 * ledgerCheckedAt (Marker nach der Klaerung) und nicht schon als extern gesendet markiert. Ob die Sequence
 * verbraucht ist, prueft der Aufrufer mit Live-Kontodaten.
 */
function isExternalCheckCandidate(storedJob) {
  if (!storedJob || typeof storedJob !== 'object') return false;
  return EXTERNAL_CHECK_STATUSES.has(storedJob.status)
    && !storedJob.ledgerCheckedAt
    && storedJob.submittedExternally !== true;
}

/**
 * maxTime plus Marge laut Serveruhr vorbei? Dann kann ein 404 schon endgueltig sein bzw. lohnt die Ledger-Zeit
 * (isLedgerPastMaxTime entscheidet). Ohne Zeitgrenze (0) nie. Die Serveruhr bestimmt nur, wann gefragt wird.
 */
function isPastMaxTimeByClock(maxTimeUnix, nowUnix) {
  const maxTime = Number(maxTimeUnix || 0);
  return maxTime > 0 && nowUnix > maxTime + SUBMIT_UNCLEAR_LEDGER_MARGIN_SECONDS;
}

/**
 * ADR 0014: Reihenfolge im gemeinsamen Budget (SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST). Zuerst submit_unclear
 * (Sendeschutz). Dann Kandidaten mit mindestens einer gueltigen gesammelten Signatur eines Signers des Job-Kontos
 * (signed) vor Jobs ohne Signatur (ES-2): Eine gueltige Signatur kann niemand ohne Key erzeugen, untergeschobene
 * unsignierte Jobs verdraengen echte Kandidaten also nicht mehr. Innerhalb jeder Gruppe zuerst Kandidaten, deren
 * maxTime plus Marge laut Serveruhr vorbei ist (ein 404 kann dort schon endgueltig sein), dann aelteste maxTime,
 * ohne Zeitgrenze (0) zuletzt. Sonst Reihenfolge der Liste (stabiles Sortieren). Die Serveruhr ordnet nur;
 * endgueltig macht einen 404 nur die Ledger-Zeit. Gleich wie skm_compare_resolve_priority in api/submitUnclear.php.
 * @param {{ unclear: boolean, signed?: boolean, maxTimeUnix: number }} a
 * @param {{ unclear: boolean, signed?: boolean, maxTimeUnix: number }} b
 */
function compareResolvePriority(a, b, nowUnix) {
  if (a.unclear !== b.unclear) return a.unclear ? -1 : 1;
  if (a.unclear) return 0;
  const signedA = a.signed === true;
  const signedB = b.signed === true;
  if (signedA !== signedB) return signedA ? -1 : 1;
  const decidable = (c) => isPastMaxTimeByClock(c.maxTimeUnix, nowUnix);
  if (decidable(a) !== decidable(b)) return decidable(a) ? -1 : 1;
  const key = (c) => (c.maxTimeUnix > 0 ? c.maxTimeUnix : Number.MAX_SAFE_INTEGER);
  return key(a) - key(b);
}

/**
 * Datensatz aus GET /transactions/{hash} als Ergebnis der Abfrage. Nur ein Datensatz zum abgefragten Hash zaehlt
 * (eigener Hash oder inner_transaction.hash eines Fee-Bumps), sonst Fehler. Ledger aus ledger_attr (SDK) oder
 * ledger (JSON), createdAt nur in der Form von Horizon (UTC mit Z), sonst null. successful nur als Boolean.
 * Gleich wie skm_transaction_lookup_from_record in api/submitUnclear.php.
 */
function transactionLookupFromRecord(rec, queriedHash) {
  if (!rec || typeof rec !== 'object' || typeof queriedHash !== 'string' || queriedHash === '') return { kind: 'error' };
  const innerHash = rec.inner_transaction && typeof rec.inner_transaction === 'object' ? rec.inner_transaction.hash : undefined;
  if (rec.hash !== queriedHash && innerHash !== queriedHash) return { kind: 'error' };
  const rawLedger = Number.isInteger(rec.ledger_attr) ? rec.ledger_attr : rec.ledger;
  return {
    kind: 'found',
    successful: typeof rec.successful === 'boolean' ? rec.successful : null,
    hash: queriedHash,
    ledger: Number.isInteger(rawLedger) ? rawLedger : null,
    createdAt: parseLedgerClosedAt(rec.created_at) !== null ? rec.created_at : null,
  };
}

/**
 * ADR 0014: Ergebnis fuer einen Kandidaten (isExternalCheckCandidate, Sequence verbraucht).
 * Gefunden und erfolgreich: submitted_success mit submittedExternally, submittedResult im F-3-Format, submittedAt
 * aus created_at von Horizon (null, wenn es fehlt). Gefunden und fehlgeschlagen: submitted_failed ebenso. Ein 404
 * nur bei ledgerPastMaxTime (R-1): obsolete_seq (die Sequence ist verbraucht), gespeichert obsolete_seq und rejected
 * bleiben. Sonst null: nichts speichern, beim naechsten Lesen erneut.
 * @param {{ kind: string, successful?: boolean|null, hash?: string, ledger?: number|null, createdAt?: string|null }} lookup
 * @param {boolean} ledgerPastMaxTime
 * @param {string} storedStatus
 * @returns {{ status: string, submittedExternally?: true, submittedResult?: object, submittedAt?: string|null } | null}
 */
function externalOutcome(lookup, ledgerPastMaxTime, storedStatus) {
  if (lookup?.kind === 'found') {
    const submittedAt = typeof lookup.createdAt === 'string' ? lookup.createdAt : null;
    if (lookup.successful === true) {
      return {
        status: 'submitted_success',
        submittedExternally: true,
        submittedResult: submitSuccessResult({ hash: lookup.hash, ledger: lookup.ledger }),
        submittedAt,
      };
    }
    if (lookup.successful === false) {
      const message = SUBMIT_UNCLEAR_FAILED_MESSAGE;
      return { status: 'submitted_failed', submittedExternally: true, submittedResult: { error: message, detail: { message, extras: {} } }, submittedAt };
    }
    return null;
  }
  if (lookup?.kind === 'not_found' && ledgerPastMaxTime === true) {
    return { status: EXTERNAL_CHECK_FINAL_STATUSES.has(storedStatus) ? storedStatus : 'obsolete_seq' };
  }
  return null;
}

// ES-9: Endzustaende, die SKM ohne Blick ins Ledger setzt. Bei ihnen markiert eine Ledger-Zeit nach maxTime plus Marge
// auch ohne verbrauchte Sequence die Klaerung als erledigt (offene Jobs setzt vorher der Waechter auf expired).
const EXTERNAL_UNCONSUMED_FINAL_STATUSES = new Set(['expired', 'obsolete_seq', 'rejected']);

/**
 * ADR 0014 (ES-9): Ergebnis fuer einen Kandidaten im Endzustand, dessen Sequence laut Live-Daten nicht verbraucht ist.
 * Meldet Horizon einen Ledger mehr als 60 s nach maxTime (R-1), kann die Transaktion nie mehr ins Ledger: Status
 * bleibt, es kommt nur ledgerCheckedAt dazu, und der Job ist kein Kandidat mehr (sonst kostete er bei jedem Lesen
 * Kontodaten). Ohne Zeitgrenze (maxTime 0, nur Altjobs) nie: Ohne maxTime gibt es keinen Zeitpunkt, ab dem die
 * Transaktion sicher nicht mehr ins Ledger kann. Offene Jobs nie (die Klaerung speichert offene Jobs nur nach einem
 * Ledger-Befund zu ihrem Hash). Sonst null. Gleich wie skm_external_unconsumed_outcome in api/submitUnclear.php.
 * @param {string} storedStatus
 * @param {boolean} ledgerPastMaxTime
 * @returns {{ status: string } | null}
 */
function externalUnconsumedOutcome(storedStatus, ledgerPastMaxTime) {
  if (ledgerPastMaxTime !== true || !EXTERNAL_UNCONSUMED_FINAL_STATUSES.has(storedStatus)) return null;
  return { status: storedStatus };
}

module.exports = {
  isExternalCheckCandidate,
  compareResolvePriority,
  transactionLookupFromRecord,
  externalOutcome,
  externalUnconsumedOutcome,
  isPastMaxTimeByClock,
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
