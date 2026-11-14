// F-3: Was von einer Horizon-Antwort beim Senden eines Multisig-Jobs gespeichert und ausgegeben wird.
// Nur Fehlertext und result_codes (Ablehnung) bzw. Hash und Ledger (Erfolg). envelope_xdr und
// result_xdr fallen weg: Die Job-Liste ist ohne Token lesbar (G-Adresse reicht), und eine vorlaeufig
// abgelehnte Transaktion (z. B. tx_insufficient_fee) koennte ein Dritter sonst bis maxTime selbst
// einreichen. Gleiches Format wie api/submitResult.php:
//   Ablehnung: { error: string, detail: { message: string, extras: { result_codes? } } }
//   Erfolg:    { hash: string|null, ledger?: number }
// sanitizeSubmittedResult bereinigt auch Altjobs (Node: error = ganze Horizon-Antwort, PHP:
// detail.extras = ganze extras, Erfolg mit envelopeXdr/resultXdr) beim Lesen.

const MAX_MESSAGE_LENGTH = 300;

function cleanText(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  // Nach Codepoints kuerzen wie mb_substr in PHP; slice() zerschnitte ein Emoji (Surrogat-Paar).
  return Array.from(value.trim()).slice(0, MAX_MESSAGE_LENGTH).join('');
}

// Nur die bekannten Felder, nur Strings. null, wenn nichts Brauchbares darin steht.
function cleanResultCodes(codes) {
  if (!codes || typeof codes !== 'object' || Array.isArray(codes)) return null;
  const out = {};
  if (typeof codes.transaction === 'string') out.transaction = codes.transaction;
  if (typeof codes.inner_transaction === 'string') out.inner_transaction = codes.inner_transaction;
  if (Array.isArray(codes.operations)) out.operations = codes.operations.filter((c) => typeof c === 'string');
  return Object.keys(out).length ? out : null;
}

function errorResult(message, codes) {
  const text = cleanText(message) || 'submit_failed';
  const resultCodes = cleanResultCodes(codes);
  return { error: text, detail: { message: text, extras: resultCodes ? { result_codes: resultCodes } : {} } };
}

/** Aus einem Fehler von Horizon.Server#submitTransaction. */
function submitErrorResult(err) {
  const data = err?.response?.data;
  const message = cleanText(data?.title) || cleanText(data?.detail) || cleanText(err?.message) || 'submit_failed';
  return errorResult(message, data?.extras?.result_codes);
}

/** Aus der Erfolgsantwort von Horizon.Server#submitTransaction. */
function submitSuccessResult(result) {
  const out = { hash: typeof result?.hash === 'string' ? result.hash : (typeof result?.id === 'string' ? result.id : null) };
  if (Number.isInteger(result?.ledger)) out.ledger = result.ledger;
  return out;
}

/** Bereinigt einen gespeicherten submittedResult (auch Altformate). null bleibt null. */
function sanitizeSubmittedResult(sr) {
  if (!sr || typeof sr !== 'object') return null;
  if (sr.error !== undefined && sr.error !== null) {
    const err = sr.error;
    const message = typeof err === 'string'
      ? err
      : (cleanText(err?.title) || cleanText(err?.detail) || cleanText(err?.message) || cleanText(sr.detail?.message));
    const codes = sr.detail?.extras?.result_codes ?? (typeof err === 'object' ? err?.extras?.result_codes : null);
    return errorResult(message, codes);
  }
  return submitSuccessResult(sr);
}

/** Job mit bereinigtem submittedResult (fuer jede Antwort, die einen Job ausgibt). */
function withSanitizedSubmitResult(job) {
  if (!job || typeof job !== 'object' || !('submittedResult' in job)) return job;
  return { ...job, submittedResult: sanitizeSubmittedResult(job.submittedResult) };
}

module.exports = { sanitizeSubmittedResult, submitErrorResult, submitSuccessResult, withSanitizedSubmitResult };
