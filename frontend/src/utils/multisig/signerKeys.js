// Signer-Adressen pruefen: nur gueltige G-Adressen (ed25519, mit Pruefsumme).
// Muxed-Adressen (M) und Secret Keys (S) sind keine Signer und werden abgelehnt.
import { StrKey } from '@stellar/stellar-sdk';

export function isValidSignerKey(key) {
  return StrKey.isValidEd25519PublicKey(String(key ?? '').trim());
}

// Erste ungueltige, nicht leere Signer-Eingabe (Zeilen mit { key } oder Strings) oder null.
export function findInvalidSignerKey(signers) {
  for (const s of signers || []) {
    const k = String(typeof s === 'string' ? s : s?.key ?? '').trim();
    if (k && !isValidSignerKey(k)) return k;
  }
  return null;
}
