// Adresstypen nach Strkey-Praefix (SEP-23).
//
// SKM arbeitet mit klassischen Konten (G) und muxed Konten (M). Contract-Adressen (C) und
// muxed Contract-Adressen (W, neu mit Protocol 30 / CAP-84) sind nur Ziele von Soroban- bzw.
// SAC-Transfers, nicht von klassischen Payment-Operationen. Sie werden deshalb erkannt und mit
// einer eigenen Meldung abgelehnt, statt als "ungueltig" zu gelten.
//
// TODO(P30-SDK): Sobald das Protocol-30-SDK eingebunden ist, W ueber die SDK-StrKey-Validierung
// pruefen (inkl. Checksumme). Bis dahin reicht Praefix + Laenge + Alphabet, da W-Adressen hier
// ausschliesslich abgelehnt und nie verwendet werden.
import { StrKey } from '@stellar/stellar-sdk';

// 1 Versionsbyte + 32 Byte Contract-ID + 8 Byte Mux-ID + 2 Byte CRC = 43 Byte -> 69 Zeichen Base32
const MUXED_CONTRACT_RE = /^W[A-Z2-7]{68}$/;

/**
 * @param {unknown} input
 * @returns {'account'|'muxed'|'contract'|'muxedContract'|'invalid'}
 */
export function classifyStellarAddress(input) {
  const v = typeof input === 'string' ? input : '';
  if (!v) return 'invalid';
  if (StrKey.isValidEd25519PublicKey(v)) return 'account';
  if (StrKey.isValidMed25519PublicKey(v)) return 'muxed';
  if (typeof StrKey.isValidContract === 'function' && StrKey.isValidContract(v)) return 'contract';
  if (MUXED_CONTRACT_RE.test(v)) return 'muxedContract';
  return 'invalid';
}

/** true fuer C- und W-Adressen: gueltige Stellar-Adressen, aber nicht fuer klassische Zahlungen. */
export function isContractAddress(input) {
  const kind = classifyStellarAddress(input);
  return kind === 'contract' || kind === 'muxedContract';
}

/** Fehlerschluessel (Namespace common) fuer die Ablehnung von C-/W-Adressen. */
export const CONTRACT_ADDRESS_ERROR = 'publicKey.contractAddress';
