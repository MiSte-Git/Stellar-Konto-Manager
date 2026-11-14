// Signaturen an eine Transaktion haengen, an einer Stelle (ADR 0012, Plan Signer-Buendelung 8.2,
// Teilschritt 3, Korrektur K3).
//
// Eine Fehlerpolitik fuer alle Aufrufer: Geht etwas schief, wird geworfen und die Transaktion bleibt
// unveraendert. Nie wird eine teilsignierte Transaktion weitergegeben. Erst wird jeder Eintrag
// geprueft, dann werden alle Signaturen erzeugt, erst danach angehaengt.
//
// Bewusst ohne signer.sign(txHash): attachSignatures bekommt die Transaktion. Ein kuenftiger
// Signer-Typ verzweigt hier. Soroban-Auth (Contract-Konto, Passkey, ML-DSA) bekommt spaeter eine
// eigene Funktion daneben, keinen Parameter hier.
import { SIGNER_TYPES } from './signerRules.js';

/** Fehler, wenn nicht signiert werden konnte (Namespace errors, wie bisher). */
export const SIGNING_FAILED_ERROR = 'submitTransaction.failed:signingFailed';
/** Fehler, wenn gar kein Schluessel uebergeben wurde. */
export const NO_KEYS_ERROR = 'submitTransaction.failed:multisig.noKeysProvided';

/**
 * @typedef {{ publicKey: string, weight: number, type?: string, keypair: import('@stellar/stellar-sdk').Keypair }} CollectedSigner
 * Format des Key-Dialogs (SecretKeyModal) und von findSessionSigner. type fehlt dort und gilt als Ed25519.
 */

/**
 * Nacktes Keypair in das Format des Key-Dialogs bringen. Wirft nie; ein unbrauchbares Keypair faellt
 * erst in der Pruefphase von attachSignatures auf.
 * @param {import('@stellar/stellar-sdk').Keypair} keypair
 * @param {{ weight?: number }} [options]
 * @returns {CollectedSigner}
 */
export function toCollectedSigner(keypair, { weight = 0 } = {}) {
  let publicKey = '';
  try {
    publicKey = keypair?.publicKey?.() || '';
  } catch {
    publicKey = '';
  }
  return { publicKey, weight, type: SIGNER_TYPES.ED25519, keypair };
}

function signingFailed(cause) {
  return new Error(SIGNING_FAILED_ERROR, cause ? { cause } : undefined);
}

// Pruefphase: Schluesselmaterial vorhanden, Typ unterstuetzt, publicKey passt. Liefert die
// Keypairs ohne Duplikate (der erste Eintrag je Key gilt) oder wirft.
function checkedKeypairs(collected) {
  if (!Array.isArray(collected) || collected.length === 0) throw new Error(NO_KEYS_ERROR);
  const seen = new Set();
  const keypairs = [];
  for (const entry of collected) {
    const keypair = entry?.keypair;
    let publicKey;
    try {
      if (!keypair || typeof keypair.canSign !== 'function' || !keypair.canSign()) throw new Error('no secret');
      publicKey = keypair.publicKey();
    } catch (e) {
      throw signingFailed(e);
    }
    const type = entry?.type;
    if (type !== undefined && type !== null && type !== SIGNER_TYPES.ED25519) {
      throw signingFailed(new Error(`unsupported signer type: ${type}`));
    }
    if (entry?.publicKey && entry.publicKey !== publicKey) {
      throw signingFailed(new Error('publicKey does not match keypair'));
    }
    if (seen.has(publicKey)) continue;
    seen.add(publicKey);
    keypairs.push(keypair);
  }
  return keypairs;
}

/**
 * Haengt die Signaturen aller Eintraege an die Transaktion (Transaction oder FeeBumpTransaction).
 * Wirft NO_KEYS_ERROR bei leerer Liste, SIGNING_FAILED_ERROR bei jedem anderen Fehler. In beiden
 * Faellen ist tx.signatures danach wie vorher.
 * @param {{ hash: () => Uint8Array, signatures: unknown[] }} tx
 * @param {CollectedSigner[]} collected
 * @returns {typeof tx} dieselbe Transaktion
 */
export function attachSignatures(tx, collected) {
  const keypairs = checkedKeypairs(collected);
  let signatures;
  try {
    const hash = tx.hash();
    signatures = keypairs.map((kp) => kp.signDecorated(hash));
  } catch (e) {
    console.error('[SKM] Signing failed', e);
    throw signingFailed(e);
  }
  tx.signatures.push(...signatures);
  return tx;
}
