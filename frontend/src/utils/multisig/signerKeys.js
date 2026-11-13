// Signer-Adressen pruefen: nur gueltige G-Adressen (ed25519, mit Pruefsumme).
// Muxed-Adressen (M) und Secret Keys (S) sind keine Signer und werden abgelehnt.
// Die Regel steht in utils/signers/signerRules.js (ADR 0012); diese Datei bleibt als Einstieg.
export { isValidSignerKey, findInvalidSignerKey } from '../signers/signerRules.js';
