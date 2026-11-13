// Kontotyp einer Stellar-Adresse (SEP-23), Backend-Zwilling von
// frontend/src/utils/stellar/addressType.js (ADR 0012, C-Konten vorbereiten). PHP-Zwilling:
// api/addressKind.php. Beide laufen gegen test/assets/address-kinds.json.
//
// Der Kontotyp wird immer aus der Adresse abgeleitet und nie gespeichert. Alle Typen werden
// ueber StrKey des SDK geprueft, inkl. Checksumme; nur isClassicAccountSyntax prueft bewusst
// nur die Syntax (bestehende Regel, siehe dort).
const { StrKey } = require('@stellar/stellar-sdk');

const ADDRESS_KINDS = Object.freeze({
  ACCOUNT: 'account',
  MUXED: 'muxed',
  CONTRACT: 'contract',
  MUXED_CONTRACT: 'muxedContract',
  INVALID: 'invalid',
});

/** @returns {'account'|'muxed'|'contract'|'muxedContract'|'invalid'} */
function classifyAddress(input) {
  const v = typeof input === 'string' ? input : '';
  if (!v) return ADDRESS_KINDS.INVALID;
  if (StrKey.isValidEd25519PublicKey(v)) return ADDRESS_KINDS.ACCOUNT;
  if (StrKey.isValidMed25519PublicKey(v)) return ADDRESS_KINDS.MUXED;
  if (StrKey.isValidContract(v)) return ADDRESS_KINDS.CONTRACT;
  if (StrKey.isValidMuxedContract(v)) return ADDRESS_KINDS.MUXED_CONTRACT;
  return ADDRESS_KINDS.INVALID;
}

/** G-Adresse zu einer G- oder M-Adresse (M: die ersten 32 Byte), sonst null. */
function baseAccountOf(input) {
  const kind = classifyAddress(input);
  if (kind === ADDRESS_KINDS.ACCOUNT) return input;
  if (kind === ADDRESS_KINDS.MUXED) {
    return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(input).subarray(0, 32));
  }
  return null;
}

/** Nur G-Adressen, mit Pruefsumme. */
function isClassicAccount(input) {
  return classifyAddress(input) === ADDRESS_KINDS.ACCOUNT;
}

/** C- und W-Adressen (Contract, muxed Contract seit Protocol 30 / CAP-84). */
function isContractAddress(input) {
  const kind = classifyAddress(input);
  return kind === ADDRESS_KINDS.CONTRACT || kind === ADDRESS_KINDS.MUXED_CONTRACT;
}

// Syntaxregel ohne Pruefsumme (G plus 55 Base32-Zeichen), wie die Regex in api/trade.php und
// isClassicAccountSyntax im Frontend. Eine Verschaerfung auf Pruefsumme waere eine eigene
// Aenderung (Plan Signer-Buendelung, Backlog).
const CLASSIC_ACCOUNT_SYNTAX_RE = /^G[A-Z2-7]{55}$/;

/** G-Adresse nach Syntax, ohne Pruefsumme. Verhalten wie RegExp.test. */
function isClassicAccountSyntax(input) {
  return CLASSIC_ACCOUNT_SYNTAX_RE.test(input);
}

module.exports = {
  ADDRESS_KINDS,
  classifyAddress,
  baseAccountOf,
  isClassicAccount,
  isClassicAccountSyntax,
  isContractAddress,
};
