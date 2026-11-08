// SEP-29: Ein Konto signalisiert ueber den Data-Entry config.memo_required = "1",
// dass eingehende Zahlungen ein Memo brauchen (typisch: Boersen und Custodians,
// die viele Kunden auf einem Konto fuehren). Ohne Memo kann der Empfaenger die
// Zahlung keinem Kunden zuordnen.
//
// Gleiche Pruefung wie Horizon.Server.checkMemoRequired() im stellar-sdk:
// Horizon liefert Data-Entries base64-kodiert in data_attr, "1" ist "MQ==".

import { AccountRequiresMemoError, NotFoundError } from '@stellar/stellar-sdk';

export const MEMO_REQUIRED_DATA_KEY = 'config.memo_required';
const MEMO_REQUIRED_VALUE_B64 = 'MQ==';

export function accountRequiresMemo(account) {
  const data = account?.data_attr;
  if (!data || typeof data !== 'object') return false;
  return data[MEMO_REQUIRED_DATA_KEY] === MEMO_REQUIRED_VALUE_B64;
}

// stellar-sdk wirft in checkMemoRequired() einen AccountRequiresMemoError, wenn ein Ziel ein Memo
// verlangt und keins gesetzt ist. Die SDK-Klasse setzt keinen eigenen name (er bleibt 'Error'),
// deshalb Erkennung ueber die Klasse selbst (instanceof). Der Name bleibt als Rueckfall fuer
// Fehler, die SKM selbst mit diesem Namen wirft (isAccountRequiresMemoError, makeMemoRequiredError).
export function isAccountRequiresMemoError(err) {
  return err instanceof AccountRequiresMemoError || err?.name === 'AccountRequiresMemoError';
}

/** Fehler "Konto verlangt ein Memo" fuer die eigene Pruefung von SKM (wie der des SDK). */
export function makeMemoRequiredError(accountId = '', operationIndex = 0) {
  return new AccountRequiresMemoError('account requires memo', accountId, operationIndex);
}

/**
 * Horizon kennt das Konto nicht (404). Erkennung ueber die Klasse des SDK (wie checkMemoRequired()
 * im SDK selbst), nicht ueber err.response.status: Bei NotFoundError ist response der Body der
 * Antwort, und der traegt "status" nur bei Horizon selbst (ein Proxy liefert anderen Inhalt).
 */
export function isNotFoundError(err) {
  return err instanceof NotFoundError;
}
