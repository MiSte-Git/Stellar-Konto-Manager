// Signer-Regeln an einer Stelle (ADR 0012, Plan Signer-Buendelung 8.2).
//
// Hier steht, welche Signer-Typen interaktiv signieren duerfen, wie der Typ eines Signers bestimmt
// wird und was ein Multisig-Konto ist. Vorher gab es sechs Kopien dieser Regel. Ein neuer
// Signer-Typ (z. B. quantensicher, siehe ADR 0012) wird spaeter hier eingehaengt.
//
// Gewicht und Typ kommen aus Horizon. Diese Datei rechnet nur, sie laedt nichts und kennt keine Secrets.
import { StrKey } from '@stellar/stellar-sdk';

/** Signer-Typen. Werte wie Horizon sie liefert, plus unknown (nie interaktiv, nie signiert). */
export const SIGNER_TYPES = Object.freeze({
  ED25519: 'ed25519_public_key',
  SHA256_HASH: 'sha256_hash',
  PRE_AUTH_TX: 'preauth_tx',
  SIGNED_PAYLOAD: 'ed25519_signed_payload',
  UNKNOWN: 'unknown',
});

const KNOWN_TYPES = new Set([
  SIGNER_TYPES.ED25519,
  SIGNER_TYPES.SHA256_HASH,
  SIGNER_TYPES.PRE_AUTH_TX,
  SIGNER_TYPES.SIGNED_PAYLOAD,
]);

/**
 * Schluessel eines Signers. Eingabeformen: String, Horizon ({ key }), Backend/Jobs ({ publicKey }),
 * aeltere Schreibweisen ({ public_key }, { ed25519PublicKey }). Leer, wenn keiner da ist.
 * @param {unknown} signer
 * @returns {string}
 */
export function signerKeyOf(signer) {
  if (typeof signer === 'string') return signer;
  if (!signer || typeof signer !== 'object') return '';
  return String(signer.key || signer.public_key || signer.publicKey || signer.ed25519PublicKey || '');
}

// Das SDK hat fuer T- und X-Adressen kein isValid..., nur decode..., das bei falscher Pruefsumme oder Laenge wirft.
function decodes(decode, key) {
  try {
    decode(key);
    return true;
  } catch {
    return false;
  }
}

// Typ aus dem Strkey, mit Pruefsumme. Nur fuer Signer ohne Horizon-Typ (z. B. job.signers aus dem Backend).
function checkedPrefixType(key) {
  if (!key) return null;
  if (StrKey.isValidEd25519PublicKey(key)) return SIGNER_TYPES.ED25519;
  if (key[0] === 'T' && decodes(StrKey.decodePreAuthTx, key)) return SIGNER_TYPES.PRE_AUTH_TX;
  if (key[0] === 'X' && decodes(StrKey.decodeSha256Hash, key)) return SIGNER_TYPES.SHA256_HASH;
  if (StrKey.isValidSignedPayload(key)) return SIGNER_TYPES.SIGNED_PAYLOAD;
  return null;
}

// Typ nur nach dem ersten Buchstaben. Dient dazu, einen Horizon-Typ gegen den Schluessel auf Widerspruch
// zu pruefen. Horizon liefert den Schluessel schon geprueft; eine zweite Pruefsumme bringt hier nichts.
function letterPrefixType(key) {
  switch (key ? key[0] : '') {
    case 'G': return SIGNER_TYPES.ED25519;
    case 'T': return SIGNER_TYPES.PRE_AUTH_TX;
    case 'X': return SIGNER_TYPES.SHA256_HASH;
    case 'P': return SIGNER_TYPES.SIGNED_PAYLOAD;
    default: return null;
  }
}

/**
 * Typ eines Signers.
 * - Mit Horizon-Typ: Horizon hat Vorrang, der Schluessel bestaetigt nur. Passt der Buchstabe (G, T, X, P)
 *   nicht zum Typ, oder ist der Typ unbekannt (z. B. ein kuenftiger PQ-Signer), ergibt das unknown.
 * - Ohne Typ: aus dem Strkey, mit Pruefsumme, sonst unknown.
 * unknown ist nie interaktiv.
 * @param {unknown} signer
 * @returns {string} einer der SIGNER_TYPES
 */
export function signerTypeOf(signer) {
  const key = signerKeyOf(signer);
  const rawType = signer && typeof signer === 'object' ? String(signer.type ?? '').trim() : '';
  if (rawType) {
    if (!KNOWN_TYPES.has(rawType)) return SIGNER_TYPES.UNKNOWN;
    return letterPrefixType(key) === rawType ? rawType : SIGNER_TYPES.UNKNOWN;
  }
  return checkedPrefixType(key) || SIGNER_TYPES.UNKNOWN;
}

/** Darf dieser Signer interaktiv signieren (Secret Key im Dialog)? Heute nur Ed25519. */
export function isInteractiveSigner(signer) {
  return signerTypeOf(signer) === SIGNER_TYPES.ED25519;
}

/**
 * Signer, die interaktiv signieren koennen und Gewicht > 0 haben.
 * @param {unknown[]} signers
 * @returns {{ publicKey: string, weight: number, type: string }[]}
 */
export function interactiveSigners(signers) {
  return (Array.isArray(signers) ? signers : [])
    .filter((s) => isInteractiveSigner(s) && Number(s?.weight || 0) > 0)
    .map((s) => ({ publicKey: signerKeyOf(s), weight: Number(s.weight), type: SIGNER_TYPES.ED25519 }));
}

/** Summe der Gewichte aller interaktiven Signer. */
export function interactiveWeight(signers) {
  return interactiveSigners(signers).reduce((sum, s) => sum + s.weight, 0);
}

/** Gueltige Signer-Adresse zum Eingeben: nur G (Ed25519, mit Pruefsumme). M- und S-Adressen sind keine Signer. */
export function isValidSignerKey(key) {
  return StrKey.isValidEd25519PublicKey(String(key ?? '').trim());
}

/** Erste ungueltige, nicht leere Signer-Eingabe (Zeilen mit { key } oder Strings) oder null. */
export function findInvalidSignerKey(signers) {
  for (const s of signers || []) {
    const k = String(typeof s === 'string' ? s : s?.key ?? '').trim();
    if (k && !isValidSignerKey(k)) return k;
  }
  return null;
}

/**
 * Regel A (gilt ueberall, Entscheidung Michael 13.11.2026): Multisig-Konto, wenn es mehr als einen Signer
 * gibt oder die High-Schwelle mehr als 1 verlangt. Alle Signer-Typen zaehlen mit.
 * @param {{ signers?: unknown[], thresholds?: object } | null} account
 */
export function isMultisigAccount(account) {
  if (!account || !account.signers || !account.thresholds) return false;

  const signerCount = Array.isArray(account.signers) ? account.signers.filter(Boolean).length : 0;
  const highThreshold = Number(account.thresholds.high ?? account.thresholds.high_threshold ?? 0);

  return signerCount > 1 || highThreshold > 1;
}

/**
 * Reicht ein einzelner interaktiver Signer fuer die geforderte Schwelle? Dann braucht die Aktion keine
 * Multisig-Abstimmung, auch wenn das Konto mehrere Signer hat (z. B. Low-Operationen wie das Einloesen
 * einer Claimable Balance bei low=1). Hash- und Pre-Auth-Signer zaehlen nie.
 */
export function singleSignerSuffices(account, requiredWeight) {
  const required = Number(requiredWeight) || 0;
  if (required <= 0) return true;
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const maxWeight = signers
    .filter(isInteractiveSigner)
    .reduce((max, s) => Math.max(max, Number(s?.weight || 0)), 0);
  return maxWeight >= required;
}
