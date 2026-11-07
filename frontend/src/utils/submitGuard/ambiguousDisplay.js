// Anzeige-Helfer fuer einen unklaren Sendestatus (gemeinsam fuer Sammelzahlung und
// "Zahlung senden"): Zeiten, Zeitpunkt der automatischen Pruefung, Diagnose-Text.
import { containsSecretKey } from '../batchPayment/batchPaymentStore.js';
import { ambiguousClearAt } from './ambiguousResolve.js';

export const AMBER_BOX_CLS = 'rounded-sm border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-2 py-1.5 text-sm font-medium text-amber-900 dark:text-amber-100';

// Uhrzeit, ab der ein unklarer Status eindeutig werden kann (lokale Zeit; Datum nur,
// wenn es nicht heute ist).
export function formatClearTime(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
}

// Wartezeit nach maxTime plus Puffer bis zur automatischen Pruefung: ein bis zwei
// Ledger (je etwa 5 s), damit Horizon den entscheidenden Ledger schon kennt.
export const AUTO_CHECK_MARGIN_MS = 10 * 1000;

// Restzeit als mm:ss (aufgerundete Sekunden).
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Zeitpunkt der automatischen Pruefung: maxTime plus Puffer plus Marge. Haengt nur am
// gespeicherten maxTime, stimmt also auch nach Neuladen.
export function autoCheckDue(entry) {
  const clearAt = ambiguousClearAt(entry);
  return clearAt ? clearAt + AUTO_CHECK_MARGIN_MS : null;
}

// Diagnose-Text ohne Secrets und ohne lange Base64-Folgen (XDR); kurz gehalten.
export function safeDiagText(value) {
  const text = String(value ?? '').slice(0, 300);
  if (containsSecretKey(text)) return '[entfernt]';
  return text.replace(/[A-Za-z0-9+/=]{56,}/g, '[…]');
}

// Diagnose eines unklaren Ausgangs fuer "Details kopieren" (eine Zeile pro Feld).
// Die Zahl der Requests nur, wenn der Sendeweg sie zaehlt (Sammelzahlung).
export function diagnosticsLines(diag, t) {
  if (!diag) return [];
  const req = diag.request || {};
  const err = req.error || {};
  const lines = [t('batchPayment:diag.title')];
  lines.push(`  ${t('batchPayment:diag.request', { method: safeDiagText(req.method || 'POST'), url: safeDiagText(req.url || '?') })}`);
  lines.push(`  ${t('batchPayment:diag.time', { at: safeDiagText(req.at || '?'), ms: Number.isFinite(req.durationMs) ? req.durationMs : '?' })}`);
  const kind = err.status
    ? t('batchPayment:diag.httpStatus', { status: err.status, statusText: safeDiagText(err.statusText || '') }).trim()
    : t('batchPayment:diag.noResponse');
  lines.push(`  ${t('batchPayment:diag.error', { name: safeDiagText(err.name || '?'), message: safeDiagText(err.message || ''), kind })}`);
  lines.push(`  ${t('batchPayment:diag.env', { online: req.online === null || req.online === undefined ? '?' : String(req.online), visibility: safeDiagText(req.visibility || '?') })}`);
  if (diag.requestsInRun !== undefined || diag.requestsSinceOpen !== undefined) {
    lines.push(`  ${t('batchPayment:diag.requests', { run: diag.requestsInRun ?? '?', total: diag.requestsSinceOpen ?? '?' })}`);
  }
  const lookups = Array.isArray(diag.lookups) ? diag.lookups : [];
  lines.push(`  ${t('batchPayment:diag.lookups', { count: lookups.length })}`);
  lookups.forEach((l, idx) => {
    let result;
    if (l.result === 'notFound') result = t('batchPayment:diag.lookupNotFound');
    else if (l.result === 'found') result = t('batchPayment:diag.lookupFound');
    else if (l.result === 'status') result = t('batchPayment:diag.lookupStatus', { status: l.status });
    else if (l.result === 'network') result = t('batchPayment:diag.lookupNetwork', { name: safeDiagText(l.name || '?'), message: safeDiagText(l.message || '') });
    else result = safeDiagText(l.result || '?');
    lines.push(`    ${idx + 1}. ${safeDiagText(l.at || '?')} ${result}`);
  });
  return lines;
}
