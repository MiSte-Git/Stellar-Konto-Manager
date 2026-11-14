// Signer-Pruefung im Node-Backend an einer Stelle (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 4).
// PHP-Zwilling: api/signerAuth.php. Beide laufen gegen test/assets/signer-types.json.
//
// Hier und nur hier wird eine Signatur geprueft (Transaktionssignatur und Challenge, ADR 0004).
// Das Backend signiert nie. Ein kuenftiger Signer-Typ (z. B. quantensicher) verzweigt hier.
const { Keypair, StrKey } = require('@stellar/stellar-sdk');

/** Einzige benannte Signaturlaenge (Ed25519). Korrektur K4: genau 64 Byte, nicht hoechstens. */
const SIGNATURE_BYTES = 64;
/** Hint einer DecoratedSignature: die letzten 4 Byte des Public Keys. */
const HINT_BYTES = 4;

const SIGNER_TYPES = Object.freeze({
  ED25519: 'ed25519_public_key',
  SHA256_HASH: 'sha256_hash',
  PRE_AUTH_TX: 'preauth_tx',
  SIGNED_PAYLOAD: 'ed25519_signed_payload',
  UNKNOWN: 'unknown',
});
const KNOWN_TYPES = new Set([SIGNER_TYPES.ED25519, SIGNER_TYPES.SHA256_HASH, SIGNER_TYPES.PRE_AUTH_TX, SIGNER_TYPES.SIGNED_PAYLOAD]);

function signerKeyOf(signer) {
  if (typeof signer === 'string') return signer;
  if (!signer || typeof signer !== 'object') return '';
  return String(signer.key || signer.public_key || signer.publicKey || signer.ed25519PublicKey || '');
}

function decodes(decode, key) {
  try {
    decode(key);
    return true;
  } catch {
    return false;
  }
}

function checkedPrefixType(key) {
  if (!key) return null;
  if (StrKey.isValidEd25519PublicKey(key)) return SIGNER_TYPES.ED25519;
  if (key[0] === 'T' && decodes(StrKey.decodePreAuthTx, key)) return SIGNER_TYPES.PRE_AUTH_TX;
  if (key[0] === 'X' && decodes(StrKey.decodeSha256Hash, key)) return SIGNER_TYPES.SHA256_HASH;
  if (StrKey.isValidSignedPayload(key)) return SIGNER_TYPES.SIGNED_PAYLOAD;
  return null;
}

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
 * Typ eines Signers, gleiche Regel wie frontend/src/utils/signers/signerRules.js: mit Horizon-Typ
 * entscheidet der Typ, der erste Buchstabe muss passen; ohne Typ der Strkey mit Pruefsumme;
 * Widerspruch oder unbekannt ergibt unknown.
 */
function signerTypeOf(signer) {
  const key = signerKeyOf(signer);
  const rawType = signer && typeof signer === 'object' ? String(signer.type ?? '').trim() : '';
  if (rawType) {
    if (!KNOWN_TYPES.has(rawType)) return SIGNER_TYPES.UNKNOWN;
    return letterPrefixType(key) === rawType ? rawType : SIGNER_TYPES.UNKNOWN;
  }
  return checkedPrefixType(key) || SIGNER_TYPES.UNKNOWN;
}

/** Nur Ed25519-Signer koennen eine Transaktion oder Challenge interaktiv signieren. */
function isInteractiveSigner(signer) {
  return signerTypeOf(signer) === SIGNER_TYPES.ED25519;
}

/**
 * Signer eines Horizon-Kontos als [{ publicKey, weight, type }]. Der Typ kommt aus Horizon und wird
 * gegen den Schluessel geprueft (signerTypeOf). Eintraege ohne Schluessel entfallen.
 */
function normalizeHorizonSigners(account) {
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  return signers
    .map((s) => ({ publicKey: signerKeyOf(s), weight: Number(s?.weight || 0), type: signerTypeOf(s) }))
    .filter((s) => s.publicKey);
}

/**
 * Strikte Dekodierung von Standard-base64 mit Padding (RFC 4648, wie das Frontend sendet).
 * Korrektur K5: kein base64url, keine Fremdzeichen, kein fehlendes Padding, keine nicht kanonische
 * Form. Liefert null bei jedem Fehler.
 * @param {unknown} value
 * @returns {Buffer|null}
 */
function decodeStrictBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return null;
  return bytes;
}

function keypairForSigner(publicKey) {
  try {
    return Keypair.fromPublicKey(publicKey);
  } catch {
    return null;
  }
}

// Rohe Bytes; stellar-sdk ab v17 liefert teils Wrapper mit toBytes() (siehe services/txSignatures.js).
function rawBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value && typeof value.toBytes === 'function') {
    const bytes = value.toBytes();
    if (bytes instanceof Uint8Array) return bytes;
  }
  return null;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Passt eine Signatur (Hint und rohe Signatur als Bytes) zu diesem Signer und Transaktions-Hash?
 * Hint genau 4 Byte, Signatur genau SIGNATURE_BYTES, Hint gleich, dann Ed25519-Pruefung. Wirft nie.
 * @param {{ hint: Uint8Array, signature: Uint8Array }} sig
 * @param {string} publicKey G-Adresse
 * @param {Uint8Array} txHash
 */
function signatureMatchesSigner(sig, publicKey, txHash) {
  try {
    const hint = sig?.hint;
    const signature = sig?.signature;
    if (!(hint instanceof Uint8Array) || !(signature instanceof Uint8Array)) return false;
    if (hint.length !== HINT_BYTES || signature.length !== SIGNATURE_BYTES) return false;
    const kp = keypairForSigner(publicKey);
    if (!kp) return false;
    const expectedHint = rawBytes(kp.signatureHint());
    if (!expectedHint || !bytesEqual(hint, expectedHint)) return false;
    return kp.verify(Buffer.from(txHash), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Prueft eine Challenge-Signatur (ADR 0004): signatureB64 strikt als Standard-base64, genau
 * SIGNATURE_BYTES, Ed25519 von publicKey ueber messageBytes. Wirft nie.
 */
function verifyChallenge(publicKey, messageBytes, signatureB64) {
  try {
    if (!messageBytes || !messageBytes.length) return false;
    const signature = decodeStrictBase64(signatureB64);
    if (!signature || signature.length !== SIGNATURE_BYTES) return false;
    const kp = keypairForSigner(publicKey);
    if (!kp) return false;
    return kp.verify(Buffer.from(messageBytes), signature);
  } catch {
    return false;
  }
}

module.exports = {
  HINT_BYTES,
  SIGNATURE_BYTES,
  SIGNER_TYPES,
  decodeStrictBase64,
  isInteractiveSigner,
  normalizeHorizonSigners,
  signatureMatchesSigner,
  signerKeyOf,
  signerTypeOf,
  verifyChallenge,
};
