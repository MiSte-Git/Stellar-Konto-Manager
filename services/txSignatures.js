// Signature hygiene for the multisig merge endpoint (finding M1, ultrareview
// 2026-07-06): the merge route used to accept every DecoratedSignature found
// in a submitted XDR verbatim into txXdrCurrent, valid or not. Since a
// signature is just an unauthenticated 4-byte hint + 64-byte blob at the XDR
// level, a caller could pad a job's stored transaction with garbage entries -
// at best wasted bytes, at worst pushing the envelope past Stellar's
// protocol-hard 20-signature ceiling and breaking it for every future
// submission attempt. This filters the merged signature set down to only
// signatures that verify against one of the account's real, live signers
// (the exact same hint+verify check collectSignersForTx already does per
// signer, just applied per individual signature here so invalid ones can be
// dropped instead of merely not counted), then caps whatever remains at 20.
const { baseAccountOf } = require('./addressKind.js');
const { HINT_BYTES, SIGNATURE_BYTES, isInteractiveSigner, signatureMatchesSigner } = require('./signerAuth.js');

const MAX_TX_SIGNATURES = 20; // Stellar XDR: Signatures is DecoratedSignature<20>
// Schwelle 0 heisst im Netz: mindestens eine gueltige Signatur eines Signers mit Gewicht > 0.
const MIN_SIGNED_WEIGHT = 1;

// Basiskonto (G-Adresse) der Transaktionsquelle: Eine M-Adresse zaehlt zu ihrem Basiskonto.
// Fee-Bump-Transaktionen sind als Job nicht vorgesehen (sie werden beim Anlegen und beim Merge
// vorher abgelehnt); hat eine keine eigene Quelle, kommt null (nie eine geliehene innere Quelle).
// Pendant: txSourceBaseAccount() in api/txSignatures.php.
function txSourceBaseAccount(tx) {
  return baseAccountOf(String(tx?.source || ''));
}

// --- SDK-Versionsunabhaengiger Zugriff auf DecoratedSignature -----------------
// stellar-sdk bis v16: Feld-Getter hint()/signature() liefern einen Buffer.
// Ab v17 (js-xdr v5): Felder sind Properties, Werte sind Wrapper-Klassen
// (xdr.SignatureHint / xdr.Signature) mit toBytes(); deren toString() liefert
// Hex statt base64, und ein .equals() vergleicht nur Wrapper untereinander.
// Alles hier arbeitet deshalb auf rohen Bytes. Was sich nicht eindeutig als
// Bytes lesen laesst, wirft - die Aufrufer behandeln das als ungueltige
// Signatur (fail closed).

function toBytes(value) {
  if (value instanceof Uint8Array) return value; // Buffer ist ein Uint8Array
  if (value && typeof value.toBytes === 'function') {
    const bytes = value.toBytes();
    if (bytes instanceof Uint8Array) return bytes;
  }
  throw new TypeError('expected bytes');
}

function readField(obj, name) {
  const value = obj?.[name];
  return typeof value === 'function' ? value.call(obj) : value;
}

/** @returns {{ hint: Uint8Array, signature: Uint8Array }} */
function decoratedSignatureBytes(sig) {
  const hint = toBytes(readField(sig, 'hint'));
  const signature = toBytes(readField(sig, 'signature'));
  // Korrektur K4: Signatur genau SIGNATURE_BYTES (vorher hoechstens 64), wie in PHP.
  if (hint.length !== HINT_BYTES || signature.length !== SIGNATURE_BYTES) throw new TypeError('malformed decorated signature');
  return { hint, signature };
}

/** Stabiler Schluessel fuer die Duplikaterkennung beim Signatur-Merge (hint:signature, base64). */
function signatureKey(sig) {
  const { hint, signature } = decoratedSignatureBytes(sig);
  return `${Buffer.from(hint).toString('base64')}:${Buffer.from(signature).toString('base64')}`;
}

// Signer, deren Signaturen zaehlen: Gewicht > 0 und interaktiv (Ed25519). Hash-, Pre-Auth- und
// Signed-Payload-Signer koennen nicht signieren und fallen hier heraus (ADR 0012).
function countingSigners(signers) {
  return (Array.isArray(signers) ? signers : [])
    .filter((s) => s?.publicKey && Number(s?.weight || 0) > 0 && isInteractiveSigner({ key: s.publicKey, type: s.type }));
}

function readSignature(sig) {
  try {
    return decoratedSignatureBytes(sig);
  } catch {
    return null;
  }
}

/**
 * Behaelt nur Signaturen, die zu einem zaehlenden Signer passen, je Signer hoechstens eine (die erste,
 * beim Merge also die schon gespeicherte), insgesamt hoechstens MAX_TX_SIGNATURES.
 * F-5: Ed25519 erlaubt mehrere verschiedene gueltige Signaturen desselben Keys (anderes Nonce). Die
 * Duplikaterkennung beim Merge (signatureKey) vergleicht nur Bytes; zwei Signaturen eines Signers
 * im Envelope lehnt das Netz mit tx_bad_auth_extra ab. Gleich wie filterValidSignatures in
 * api/txSignatures.php.
 * @param {import('@stellar/stellar-sdk').Transaction} tx
 * @param {{ publicKey: string, weight: number, type?: string }[]} signers
 * @returns {import('@stellar/stellar-sdk').xdr.DecoratedSignature[]}
 */
function filterValidSignatures(tx, signers = []) {
  const txHash = toBytes(tx.hash());
  const candidates = countingSigners(signers);
  const usedSigners = new Set();
  const kept = tx.signatures.filter((sig) => {
    const bytes = readSignature(sig);
    if (!bytes) return false;
    const signer = candidates.find((s) => signatureMatchesSigner(bytes, s.publicKey, txHash));
    if (!signer || usedSigners.has(signer.publicKey)) return false;
    usedSigners.add(signer.publicKey);
    return true;
  });
  return kept.slice(0, MAX_TX_SIGNATURES);
}

/**
 * Signer mit gueltiger Signatur auf tx, je Konto einmal, mit dem Gewicht laut signers. Einzige Quelle
 * fuer collectedWeight (gleicher Aufbau wie verifyCollected in api/txSignatures.php). Ersetzt
 * collectSignersForTx mit WebAuth.verifyTxSignedBy (Plan 8.2, Teilschritt 4). Unterschied zu frueher:
 * Signer mit Gewicht 0 erscheinen nicht mehr in der Liste (wie in PHP), das Gewicht bleibt gleich.
 * @param {import('@stellar/stellar-sdk').Transaction} tx
 * @param {{ publicKey: string, weight: number, type?: string }[]} signers
 * @returns {{ publicKey: string, weight: number }[]}
 */
function verifyCollected(tx, signers = []) {
  const txHash = toBytes(tx.hash());
  const sigs = tx.signatures.map(readSignature).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const s of countingSigners(signers)) {
    if (seen.has(s.publicKey)) continue;
    if (sigs.some((bytes) => signatureMatchesSigner(bytes, s.publicKey, txHash))) {
      seen.add(s.publicKey);
      result.push({ publicKey: s.publicKey, weight: Number(s.weight) });
    }
  }
  return result;
}

// Stellar's protocol assigns each operation type to a threshold category
// (low/medium/high) - SetOptions and AccountMerge are High, AllowTrust/
// Inflation/BumpSequence/SetTrustLineFlags are Low, everything else
// (Payment, CreateAccount, ChangeTrust, ManageData, ...) is Medium. Mirrors
// the identical categorization in api/txSignatures.php's requiredWeightForOperations().
const HIGH_THRESHOLD_OP_TYPES = new Set(['setOptions', 'accountMerge']);
// claimClaimableBalance ist laut Protokoll Low (developers.stellar.org, List of operations).
const LOW_THRESHOLD_OP_TYPES = new Set(['allowTrust', 'inflation', 'bumpSequence', 'setTrustLineFlags', 'claimClaimableBalance']);

function operationThresholdCategory(opType) {
  if (HIGH_THRESHOLD_OP_TYPES.has(opType)) return 'high';
  if (LOW_THRESHOLD_OP_TYPES.has(opType)) return 'low';
  return 'med';
}

/**
 * Gewicht, das die ganze Transaktion braucht. Das Netz prueft jede Operation gegen die Schwelle
 * ihrer Kategorie und die Transaktion selbst gegen low_threshold. Deshalb zaehlt das Maximum ueber
 * low und alle vorkommenden Kategorien, nicht nur die hoechste Kategorie (Schwellen muessen nicht
 * aufsteigend sein). Gleich wie frontend/src/utils/getRequiredThreshold.js und api/txSignatures.php.
 * @param {{ type?: string }[]} operations
 * @param {{ low?: number, med?: number, high?: number }} thresholds
 * @returns {number}
 */
function requiredWeightForOperations(operations, thresholds) {
  const low = Number(thresholds?.low || 0);
  const med = Number(thresholds?.med || 0);
  const high = Number(thresholds?.high || 0);
  const opTypes = (operations || []).map((op) => op?.type).filter(Boolean);
  // Ohne erkennbare Operationen bewusst streng: mindestens Medium.
  if (!opTypes.length) return Math.max(low, med, MIN_SIGNED_WEIGHT);

  // Netzregel, belegt auf dem Testnet am 14.11.2026 (scripts/testnet-threshold-probe.mjs, Faelle A bis K):
  // jede Transaktion braucht mindestens low_threshold (tx-Ebene), jede Operation zusaetzlich die
  // Schwelle ihrer Kategorie, und mindestens eine gueltige Signatur. Eine Kategorie-Schwelle 0
  // faellt nicht auf eine andere Schwelle zurueck (Probe G). Also max(low, Schwellen der vorkommenden Kategorien, 1).
  // Grenze: setOptions ohne Signer-, Gewichts- oder Schwellen-Aenderung zaehlt im Netz als Medium;
  // hier gilt setOptions immer als High (strenger, SKM baut nur High-setOptions).
  const byCategory = { low, med, high };
  const categoryWeights = [...new Set(opTypes.map(operationThresholdCategory))].map((c) => byCategory[c]);
  return Math.max(low, ...categoryWeights, MIN_SIGNED_WEIGHT);
}

module.exports = {
  filterValidSignatures,
  verifyCollected,
  signatureKey,
  decoratedSignatureBytes,
  MAX_TX_SIGNATURES,
  operationThresholdCategory,
  requiredWeightForOperations,
  txSourceBaseAccount,
};
