// Shared helper for submitting a signed transaction to Horizon while handling
// ambiguous network failures (timeout / 5xx) that leave the actual outcome
// unknown - the transaction may have been applied even though the request
// itself failed. Used by SendPaymentPage.jsx and AssetSearch.jsx so both
// treat "we don't know if this went through" the same way instead of letting
// the caller resubmit blindly and risk a duplicate operation.

import { xdr } from '@stellar/stellar-sdk';
import { txHashHex } from './txHash.js';
import { feeBumpHashOf, recordMatchesHash } from '../submitGuard/ambiguousResolve.js';
import { isAccountRequiresMemoError } from './memoRequired.js';
import { loadWithBackoff } from './retryLoad.js';

export function isAmbiguousSubmitError(err) {
  const extras = err?.response?.data?.extras;
  if (extras?.result_codes) return false;
  const status = err?.response?.status;
  return !status || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// Kurze Beschreibung eines Fehlers fuer die Diagnose: Name, Meldung, HTTP-Status oder
// "keine lesbare Antwort" (fetch ohne Response: Netzfehler, CORS, Blocker). Keine Bodies.
export function describeRequestError(err) {
  const status = Number(err?.response?.status) || null;
  return {
    name: String(err?.name || 'Error').slice(0, 60),
    message: String(err?.message || err || '').slice(0, 200),
    status,
    statusText: status ? String(err?.response?.statusText || '').slice(0, 60) : '',
    readable: !!status,
  };
}

// Methode und URL (nur Origin und Pfad, ohne Query und Zugangsdaten) der Anfrage, die gescheitert
// ist, soweit der Fehler sie traegt (axios: config, beim SDK auch unter cause). Kein Body, keine
// Header. null, wenn nichts bekannt ist.
export function requestTargetOf(err) {
  const cfg = err?.config || err?.cause?.config;
  if (!cfg?.url) return null;
  try {
    const u = new URL(String(cfg.url), cfg.baseURL ? String(cfg.baseURL) : undefined);
    return { method: String(cfg.method || 'get').toUpperCase(), url: `${u.origin}${u.pathname}` };
  } catch {
    return null;
  }
}

// URL eines Horizon-Endpunkts ohne Query (nur Origin und Pfad), '' wenn unbekannt.
function horizonEndpointUrl(server, path) {
  try {
    const base = new URL(String(server?.serverURL || ''));
    const pathname = `${base.pathname.replace(/\/+$/, '')}/${path}`;
    return `${base.origin}${pathname}`;
  } catch {
    return '';
  }
}

// lookups (optional): Array, in das jede Abfrage ihr Ergebnis schreibt
// ({ at, result: 'found' | 'notFound' | 'status' | 'network', status?, name?, message? }).
export async function findSubmittedTransaction(server, hash, { attempts = 8, delayMs = 1500, lookups = null } = {}) {
  if (!hash) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const at = new Date().toISOString();
    try {
      const record = await server.transactions().transaction(hash).call();
      // Nur ein Datensatz mit genau diesem Hash zaehlt (nicht jede 200-Antwort), auch als
      // innere Transaktion eines Fee-Bumps.
      if (recordMatchesHash(record, hash)) {
        lookups?.push({ at, result: 'found' });
        return record;
      }
      lookups?.push({ at, result: 'empty' });
    } catch (lookupErr) {
      const status = lookupErr?.response?.status;
      if (status && status !== 404) {
        console.debug?.('transaction confirmation lookup failed', lookupErr);
      }
      if (status === 404) lookups?.push({ at, result: 'notFound', status: 404 });
      else {
        const d = describeRequestError(lookupErr);
        lookups?.push({ at, result: status ? 'status' : 'network', status: d.status, name: d.name, message: d.message });
      }
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

// Thrown instead of the original network error when a submit failed
// ambiguously and the follow-up hash lookup could not confirm either
// outcome. Callers should surface this distinctly (not as a generic
// failure) and block immediate resubmission until the user has checked
// the transaction hash manually.
// diagnostics (optional): { request: { method, url, at, durationMs, error, online, visibility },
// lookups: [...] } ohne Body, XDR oder Secrets (siehe submitTransactionSafely).
// Thrown BEFORE anything was sent: the pre-submit memo check (SEP-29, loads the destination
// account with GET) failed for a network or server reason. Nothing was posted, the outcome is
// not unclear; the user can simply try again. request: { method, url } of the failed GET.
export class PreSubmitCheckError extends Error {
  constructor(cause) {
    super('submitTransaction.failed:memoCheck.unreachable');
    this.name = 'PreSubmitCheckError';
    this.cause = cause;
    this.request = requestTargetOf(cause);
  }
}

export class AmbiguousSubmitResultError extends Error {
  constructor(hash, cause, diagnostics = null) {
    super('submitTransaction.ambiguousResult');
    this.name = 'AmbiguousSubmitResultError';
    this.hash = hash;
    this.cause = cause;
    this.diagnostics = diagnostics;
  }
}

// Horizon fuehrt auch fehlgeschlagene Transaktionen im Ledger (Gebuehr bezahlt, Operationen
// nicht ausgefuehrt, successful === false). Wird eine solche Transaktion nach einem
// mehrdeutigen Submit-Fehler gefunden, ist das Ergebnis eindeutig: fehlgeschlagen.
// Der Fehler bildet die Form einer normalen Horizon-Ablehnung nach (response.data.extras.
// result_codes), damit die bestehenden Fehleranzeigen ihn ohne Sonderfall darstellen.
export class SubmittedTransactionFailedError extends Error {
  constructor(hash, record) {
    super('submitTransaction.ledgerFailed');
    this.name = 'SubmittedTransactionFailedError';
    this.hash = hash;
    this.feeBumpHash = feeBumpHashOf(record, hash);
    this.record = record;
    this.response = {
      status: 400,
      data: { extras: { result_codes: { transaction: txResultCodeFromXdr(record?.result_xdr) } } },
    };
  }
}

// result_xdr -> Horizon-Schreibweise, z. B. txFailed -> tx_failed
// Bei einem Fee-Bump-Datensatz zaehlt das Ergebnis der inneren Transaktion (unsere), nicht
// txFeeBumpInnerFailed/-Success der aeusseren.
const xdrField = (o, k) => (typeof o?.[k] === 'function' ? o[k]() : o?.[k]);
const xdrUnionName = (u) => (typeof u?.switch === 'function' ? u.switch().name : u?.type);
const xdrUnionValue = (u) => (typeof u?.value === 'function' ? u.value() : u?.value);

export function txResultCodeFromXdr(resultXdr) {
  try {
    // v16: Feld-Getter result() und Union-Diskriminante switch().name;
    // ab v17 (js-xdr v5) Felder als Properties und Diskriminante als .type.
    const decoded = xdr.TransactionResult.fromXDR(resultXdr, 'base64');
    const inner = xdrField(decoded, 'result');
    let name = xdrUnionName(inner);
    if (name === 'txFeeBumpInnerFailed' || name === 'txFeeBumpInnerSuccess') {
      const pair = xdrUnionValue(inner);
      const innerName = xdrUnionName(xdrField(xdrField(pair, 'result'), 'result'));
      if (typeof innerName === 'string' && innerName) name = innerName;
    }
    if (typeof name !== 'string' || !name) return 'tx_failed';
    return name.replace(/([A-Z])/g, '_$1').toLowerCase();
  } catch {
    return 'tx_failed';
  }
}

/**
 * Memo-Pflicht (SEP-29) der FERTIG GEBAUTEN Transaktion pruefen (checkMemoRequired des SDK: Ziel
 * jeder payment-, pathPayment- und accountMerge-Operation, ohne Memo und ohne M-Adresse). Fail-closed:
 * Ein Fehler beim Laden (Netz, Server) oder ein Server ohne diese Methode ist PreSubmitCheckError,
 * also "nichts gesendet". AccountRequiresMemoError kommt unveraendert durch. Wiederholt wird nur das
 * Laden (GET). sleep: nur fuer Tests.
 */
export async function verifyMemoRequired(server, tx, { sleep } = {}) {
  if (typeof server?.checkMemoRequired !== 'function') {
    throw new PreSubmitCheckError(new Error('checkMemoRequired unavailable'));
  }
  try {
    await loadWithBackoff(() => server.checkMemoRequired(tx), sleep ? { sleep } : {});
  } catch (checkErr) {
    if (isAccountRequiresMemoError(checkErr)) throw checkErr;
    throw new PreSubmitCheckError(checkErr);
  }
}

/**
 * skipMemoRequiredCheck: Der Aufrufer hat die Memo-Pruefung (SEP-29) selbst gemacht oder sie ist
 * nicht noetig. Sonst laeuft sie hier VOR dem Senden, getrennt vom POST: ein Fehler dabei (Netz,
 * Server) ist PreSubmitCheckError, also eindeutig "nichts gesendet", nie "unklar". Nur das Laden
 * der Empfaengerkonten wird mit Wartezeit wiederholt (GET), der POST nie.
 * sleep: nur fuer Tests.
 */
export async function submitTransactionSafely(server, tx, { skipMemoRequiredCheck = false, sleep } = {}) {
  const hash = txHashHex(tx);
  const startedAt = Date.now();
  let opts;
  if (skipMemoRequiredCheck) {
    opts = { skipMemoRequiredCheck: true };
  } else if (typeof server?.checkMemoRequired === 'function') {
    await verifyMemoRequired(server, tx, { sleep });
    opts = { skipMemoRequiredCheck: true };
  }
  try {
    return await (opts ? server.submitTransaction(tx, opts) : server.submitTransaction(tx));
  } catch (err) {
    if (!isAmbiguousSubmitError(err)) throw err;
    // Zustand zum Zeitpunkt des Fehlers, bevor die Nachfragen laufen.
    // Echte Methode und URL der gescheiterten Anfrage, falls der Fehler sie traegt.
    const target = requestTargetOf(err);
    const request = {
      method: target?.method || 'POST',
      url: target?.url || horizonEndpointUrl(server, 'transactions'),
      at: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      error: describeRequestError(err),
      online: typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
      visibility: typeof document !== 'undefined' ? document.visibilityState || '' : '',
    };
    const lookups = [];
    const confirmed = await findSubmittedTransaction(server, hash, { lookups });
    // Erfolg nur mit successful === true; ohne eindeutiges Feld bleibt der Ausgang offen.
    if (confirmed?.successful === false) throw new SubmittedTransactionFailedError(hash, confirmed);
    if (confirmed?.successful === true) return withSubmittedHash(confirmed, hash);
    throw new AmbiguousSubmitResultError(hash, err, { request, lookups });
  }
}

/**
 * Ergebnis eines gefundenen Datensatzes mit dem Hash, den wir gesendet haben (hash, id).
 * War es ein Fee-Bump einer anderen Partei um unsere Transaktion, steht dessen Hash
 * zusaetzlich in feeBumpHash (fuer Details).
 */
export function withSubmittedHash(record, hash) {
  const feeBumpHash = feeBumpHashOf(record, hash);
  if (!feeBumpHash && String(record?.hash || '').toLowerCase() === String(hash).toLowerCase()) return record;
  return { ...record, hash, id: hash, ...(feeBumpHash ? { feeBumpHash } : {}) };
}
