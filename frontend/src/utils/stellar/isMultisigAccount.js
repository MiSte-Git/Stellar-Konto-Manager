// Die Regeln selbst stehen in utils/signers/signerRules.js (ADR 0012). Diese Datei bleibt als Einstieg
// fuer die bestehenden Aufrufer und enthaelt nur noch die Verknuepfung.
import { isMultisigAccount, singleSignerSuffices } from '../signers/signerRules.js';

export { isMultisigAccount, singleSignerSuffices };

// Mehrere Signaturen noetig: Multisig-Konto und kein einzelner Signer erreicht die Schwelle.
export function needsMultipleSignatures(account, requiredWeight) {
  return isMultisigAccount(account) && !singleSignerSuffices(account, requiredWeight);
}
