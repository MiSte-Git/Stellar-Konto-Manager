// Ausgang einer Kontoaktivierung (Friendbot oder createAccount ueber Horizon) einordnen.
//
// 'success'   Konto wurde mit dieser Anfrage angelegt.
// 'exists'    Konto existiert (schon vorher oder durch einen frueheren Versuch).
// 'rejected'  eindeutig abgelehnt, mit dieser Anfrage wurde nichts angelegt.
// 'ambiguous' Ausgang unklar (keine Antwort, Timeout, Serverfehler, Rate-Limit): Das Konto
//             kann existieren und Guthaben haben. Der Secret Key muss erhalten bleiben.
//
// Im Zweifel 'ambiguous': Faelschlich "abgelehnt" verwirft den Key eines womoeglich
// gefuellten Kontos, faelschlich "unklar" kostet nur einen Hinweis.

const EXISTS_RE = /already[\s_-]*(exists?|funded)|op_already_exists|createAccountAlreadyExist/i;

/** Lesbarer Fehlertext aus einem Antwortkoerper, sonst ''. HTML (Proxy-Seiten) zaehlt nicht. */
function errorTextOf(bodyText) {
  const text = String(bodyText || '').trim();
  if (!text) return '';
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') {
      const codes = data.extras?.result_codes;
      return String(data.detail || data.title || data.error || data.message || (codes ? JSON.stringify(codes) : '')).trim();
    }
  } catch { /* kein JSON */ }
  if (text.startsWith('<')) return '';
  return text;
}

/**
 * Friendbot-Antwort einordnen.
 * @param {number} status HTTP-Status
 * @param {string} bodyText Antwortkoerper als Text
 * @returns {'success'|'exists'|'rejected'|'ambiguous'}
 */
export function classifyFriendbotResponse(status, bodyText = '') {
  const code = Number(status) || 0;
  if (code >= 200 && code < 300) return 'success';
  if (EXISTS_RE.test(String(bodyText || ''))) return 'exists';
  // Rate-Limit, Timeout und Serverfehler: Friendbot kann trotzdem gesendet haben
  if (code === 408 || code === 429 || code >= 500 || code < 400) return 'ambiguous';
  // Uebrige 4xx nur mit erkennbarem Fehlertext eindeutig
  return errorTextOf(bodyText) ? 'rejected' : 'ambiguous';
}

/**
 * Fehler von server.submitTransaction(createAccount) einordnen.
 * Eindeutig nur mit result_codes von Horizon (die Transaktion wurde geprueft bzw. ist
 * fehlgeschlagen); ohne sie (Timeout 504, Netzfehler) ist der Ausgang unklar.
 * @returns {'exists'|'rejected'|'ambiguous'}
 */
export function classifyHorizonSubmitError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (!codes) return 'ambiguous';
  const ops = Array.isArray(codes.operations) ? codes.operations : [];
  if (ops.includes('op_already_exists')) return 'exists';
  return 'rejected';
}

/** loadAccount-Fehler: Konto existiert sicher nicht (404), sonst unbekannt. */
export function isAccountNotFoundError(err) {
  const status = err?.response?.status ?? err?.status;
  return Number(status) === 404 || err?.name === 'NotFoundError';
}
