// Adresstypen nach Strkey-Praefix (SEP-23).
//
// SKM arbeitet mit klassischen Konten (G) und muxed Konten (M). Contract-Adressen (C) und
// muxed Contract-Adressen (W, neu mit Protocol 30 / CAP-84) sind nur Ziele von Soroban- bzw.
// SAC-Transfers, nicht von klassischen Payment-Operationen. Sie werden deshalb erkannt und mit
// einer eigenen Meldung abgelehnt, statt als "ungueltig" zu gelten. Alle Typen werden ueber
// StrKey des SDK geprueft, inkl. Checksumme.
//
// Einzige Stelle, die den Kontotyp einer Adresse bestimmt (ADR 0012, C-Konten vorbereiten).
// Der Kontotyp wird immer aus der Adresse abgeleitet und nie gespeichert.
import { StrKey } from '@stellar/stellar-sdk';

/** Werte von classifyStellarAddress. */
export const ADDRESS_KINDS = Object.freeze({
  ACCOUNT: 'account',
  MUXED: 'muxed',
  CONTRACT: 'contract',
  MUXED_CONTRACT: 'muxedContract',
  INVALID: 'invalid',
});

/**
 * @param {unknown} input
 * @returns {'account'|'muxed'|'contract'|'muxedContract'|'invalid'}
 */
export function classifyStellarAddress(input) {
  const v = typeof input === 'string' ? input : '';
  if (!v) return 'invalid';
  if (StrKey.isValidEd25519PublicKey(v)) return 'account';
  if (StrKey.isValidMed25519PublicKey(v)) return 'muxed';
  if (StrKey.isValidContract(v)) return 'contract';
  if (StrKey.isValidMuxedContract(v)) return 'muxedContract';
  return 'invalid';
}

/** true fuer C- und W-Adressen: gueltige Stellar-Adressen, aber nicht fuer klassische Zahlungen. */
export function isContractAddress(input) {
  const kind = classifyStellarAddress(input);
  return kind === 'contract' || kind === 'muxedContract';
}

/** Fehlerschluessel (Namespace common) fuer die Ablehnung von C-/W-Adressen. */
export const CONTRACT_ADDRESS_ERROR = 'publicKey.contractAddress';

/** Fehlerschluessel fuer eine ungueltige Adresse, gleich wie in resolveOrValidateAccount. */
export const INVALID_ADDRESS_ERROR = 'resolveOrValidatePublicKey.invalid';

// M-Adresse: 32 Byte Ed25519-Key, dann 8 Byte ID (big-endian).
function decodeMuxed(address) {
  const raw = StrKey.decodeMed25519PublicKey(address);
  let id = 0n;
  for (const b of raw.subarray(-8)) {
    id = (id << 8n) + BigInt(b);
  }
  return {
    baseAccountId: StrKey.encodeEd25519PublicKey(raw.subarray(0, -8)),
    muxedId: id.toString(10),
  };
}

/**
 * Zerlegt eine Adresse in Typ, Basiskonto und M-ID. Wirft nie.
 * address: die Eingabe, wenn sie eine gueltige Adresse ist, sonst ''.
 * baseAccountId: G-Adresse fuer G und M, sonst null. muxedId: Dezimal-String nur fuer M, sonst null.
 * @param {unknown} input
 * @returns {{ kind: string, address: string, baseAccountId: string|null, muxedId: string|null }}
 */
export function parseStellarAddress(input) {
  const kind = classifyStellarAddress(input);
  if (kind === ADDRESS_KINDS.INVALID) return { kind, address: '', baseAccountId: null, muxedId: null };
  if (kind === ADDRESS_KINDS.ACCOUNT) return { kind, address: input, baseAccountId: input, muxedId: null };
  if (kind === ADDRESS_KINDS.MUXED) return { kind, address: input, ...decodeMuxed(input) };
  return { kind, address: input, baseAccountId: null, muxedId: null };
}

/** G-Adresse zu einer G- oder M-Adresse, sonst null. */
export function baseAccountOf(input) {
  return parseStellarAddress(input).baseAccountId;
}

/** Nur G-Adressen, mit Pruefsumme. */
export function isClassicAccount(input) {
  return classifyStellarAddress(input) === ADDRESS_KINDS.ACCOUNT;
}

// Heutige Syntaxregel der Trading-Suche, ohne Pruefsumme. Nicht auf StrKey umstellen, ohne
// die Verschaerfung als eigene Aenderung zu behandeln (Plan Signer-Buendelung, Backlog).
const CLASSIC_ACCOUNT_SYNTAX_RE = /^G[A-Z2-7]{55}$/;

/** G-Adresse nach Syntax (G plus 55 Base32-Zeichen), ohne Pruefsumme. Verhalten wie RegExp.test. */
export function isClassicAccountSyntax(input) {
  return CLASSIC_ACCOUNT_SYNTAX_RE.test(input);
}

/** Beginnt mit G (nur String), ohne weitere Pruefung. Fuer Stellen, die heute nur das Praefix pruefen. */
export function hasClassicAccountPrefix(input) {
  return typeof input === 'string' && input.startsWith('G');
}

/** Ziel einer klassischen Zahlung: G oder M, mit Pruefsumme. */
export function isPaymentDestination(input) {
  const kind = classifyStellarAddress(input);
  return kind === ADDRESS_KINDS.ACCOUNT || kind === ADDRESS_KINDS.MUXED;
}

/**
 * Prueft, dass die Adresse einen der erlaubten Typen hat, und gibt sie zerlegt zurueck.
 * C/W ausserhalb von allowed: Error(CONTRACT_ADDRESS_ERROR); sonst ungueltig: Error(INVALID_ADDRESS_ERROR).
 * @param {unknown} input
 * @param {string[]} [allowed] Standard: G und M
 */
export function assertSupportedAddress(input, allowed = [ADDRESS_KINDS.ACCOUNT, ADDRESS_KINDS.MUXED]) {
  const parsed = parseStellarAddress(input);
  if (allowed.includes(parsed.kind)) return parsed;
  if (parsed.kind === ADDRESS_KINDS.CONTRACT || parsed.kind === ADDRESS_KINDS.MUXED_CONTRACT) {
    throw new Error(CONTRACT_ADDRESS_ERROR);
  }
  throw new Error(INVALID_ADDRESS_ERROR);
}
