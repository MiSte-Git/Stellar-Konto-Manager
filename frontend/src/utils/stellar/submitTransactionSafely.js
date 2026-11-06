// Shared helper for submitting a signed transaction to Horizon while handling
// ambiguous network failures (timeout / 5xx) that leave the actual outcome
// unknown - the transaction may have been applied even though the request
// itself failed. Used by SendPaymentPage.jsx and AssetSearch.jsx so both
// treat "we don't know if this went through" the same way instead of letting
// the caller resubmit blindly and risk a duplicate operation.

import { xdr } from '@stellar/stellar-sdk';
import { txHashHex } from './txHash.js';

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
      // Nur ein Datensatz mit genau diesem Hash zaehlt (nicht jede 200-Antwort).
      const recordHash = String(record?.hash || record?.id || '').toLowerCase();
      if (recordHash && recordHash === String(hash).toLowerCase()) {
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
    this.record = record;
    this.response = {
      status: 400,
      data: { extras: { result_codes: { transaction: txResultCodeFromXdr(record?.result_xdr) } } },
    };
  }
}

// result_xdr -> Horizon-Schreibweise, z. B. txFailed -> tx_failed
export function txResultCodeFromXdr(resultXdr) {
  try {
    // v16: Feld-Getter result() und Union-Diskriminante switch().name;
    // ab v17 (js-xdr v5) Felder als Properties und Diskriminante als .type.
    const decoded = xdr.TransactionResult.fromXDR(resultXdr, 'base64');
    const inner = typeof decoded.result === 'function' ? decoded.result() : decoded.result;
    const name = typeof inner?.switch === 'function' ? inner.switch().name : inner?.type;
    if (typeof name !== 'string' || !name) return 'tx_failed';
    return name.replace(/([A-Z])/g, '_$1').toLowerCase();
  } catch {
    return 'tx_failed';
  }
}

export async function submitTransactionSafely(server, tx) {
  const hash = txHashHex(tx);
  const startedAt = Date.now();
  try {
    return await server.submitTransaction(tx);
  } catch (err) {
    if (!isAmbiguousSubmitError(err)) throw err;
    // Zustand zum Zeitpunkt des Fehlers, bevor die Nachfragen laufen.
    const request = {
      method: 'POST',
      url: horizonEndpointUrl(server, 'transactions'),
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
    if (confirmed?.successful === true) return confirmed;
    throw new AmbiguousSubmitResultError(hash, err, { request, lookups });
  }
}
