// Schluesselmaterial an einer Stelle (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 2).
//
// Aus einem Secret Key wird hier und nur hier ein Keypair. Heute ist das immer Ed25519 (S-Strkey).
// Kommt spaeter ein anderer Signer-Typ dazu (z. B. quantensicher), verzweigt diese Datei, nicht
// jede Seite einzeln.
//
// Verhaltensneutral: keypairFromSecret wirft bei ungueltigem Secret denselben Fehler wie das SDK.
// Die Aufrufer fangen ihn wie bisher ab und zeigen ihre eigene Meldung. Secrets werden hier weder
// gespeichert noch geloggt (AGENTS.md Regel 2).
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Keypair aus einem Secret Key (S...). Wirft wie Keypair.fromSecret bei ungueltiger Eingabe.
 * @param {string} secret
 * @returns {import('@stellar/stellar-sdk').Keypair}
 */
export function keypairFromSecret(secret) {
  return Keypair.fromSecret(secret);
}

/**
 * Wirft Error('secretKey.mismatch'), wenn das Keypair nicht zum erwarteten Public Key gehoert.
 * @param {import('@stellar/stellar-sdk').Keypair} keypair
 * @param {string} expectedPublicKey
 */
export function assertKeypairFor(keypair, expectedPublicKey) {
  if (keypair.publicKey() !== expectedPublicKey) {
    throw new Error('secretKey.mismatch');
  }
}

/**
 * Rohe Signatur ueber eine Nachricht. Nur fuer Server-Challenges (signMultisigJobChallenge in
 * multisigApi.js), die immer mit dem Zweck-Praefix skm:<zweck>: beginnen (AGENTS.md Regel 3,
 * ADR 0004). Nie fuer Transaktionen; die laufen ueber tx.sign (Teilschritt 3: attachSignatures).
 * @param {import('@stellar/stellar-sdk').Keypair} keypair
 * @param {Uint8Array} messageBytes
 * @returns {Uint8Array} Signatur
 */
export function signChallengeMessage(keypair, messageBytes) {
  return keypair.sign(messageBytes);
}
