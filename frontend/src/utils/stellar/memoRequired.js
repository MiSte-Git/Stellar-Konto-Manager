// SEP-29: Ein Konto signalisiert ueber den Data-Entry config.memo_required = "1",
// dass eingehende Zahlungen ein Memo brauchen (typisch: Boersen und Custodians,
// die viele Kunden auf einem Konto fuehren). Ohne Memo kann der Empfaenger die
// Zahlung keinem Kunden zuordnen.
//
// Gleiche Pruefung wie Horizon.Server.checkMemoRequired() im stellar-sdk:
// Horizon liefert Data-Entries base64-kodiert in data_attr, "1" ist "MQ==".

export const MEMO_REQUIRED_DATA_KEY = 'config.memo_required';
const MEMO_REQUIRED_VALUE_B64 = 'MQ==';

export function accountRequiresMemo(account) {
  const data = account?.data_attr;
  if (!data || typeof data !== 'object') return false;
  return data[MEMO_REQUIRED_DATA_KEY] === MEMO_REQUIRED_VALUE_B64;
}

// stellar-sdk wirft beim submitTransaction() selbst einen AccountRequiresMemoError,
// wenn ein Ziel ein Memo verlangt und keins gesetzt ist. Erkennung ueber den Namen,
// damit kein harter Import der Fehlerklasse noetig ist.
export function isAccountRequiresMemoError(err) {
  return err?.name === 'AccountRequiresMemoError';
}
