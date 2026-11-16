// Challenge-response nonce store for the multisig job token endpoint.
//
// Closes finding H1 (Ultrareview 2026-07-06): the token endpoint used to hand
// out a job's accessToken to anyone who merely *named* a public key that
// happened to be an active signer on-chain - no proof the caller actually
// holds that key's private half was required, and signer lists are public on
// Horizon. This module adds the missing possession proof: the caller must
// first request a short-lived, single-use nonce for (jobId, signerPublicKey),
// then sign it with the claimed key before a token is issued. Beim Einloesen
// schickt der Client die Nonce mit; verbraucht wird nur genau diese.
//
// In-memory only (no disk persistence, unlike the job store): server.js is a
// single long-running process, and a challenge is only ever useful for ~60s -
// losing pending challenges on a restart just means the client requests a
// fresh one, which is a non-issue.
const crypto = require('crypto');
const { decodeStrictBase64, verifyChallenge } = require('./signerAuth.js');

const DEFAULT_TTL_MS = 60_000;
// Obergrenzen, damit die Map mit zufaelligen Keys nicht beliebig waechst (C2).
// Gleich in api/challengeStore.php.
const MAX_CHALLENGES_TOTAL = 2000;
const MAX_CHALLENGES_PER_JOB = 20;
// Offene Challenges je (jobId, signer). Mehrere, damit ein Dritter mit jobId und Signer-Adresse
// (beides oeffentlich) die Challenge eines ehrlichen Signers nicht ueberschreiben kann.
const MAX_CHALLENGES_PER_SIGNER = 5;
// Laenge der Nonce in Byte, gleich wie CHALLENGE_NONCE_BYTES im Frontend.
const CHALLENGE_NONCE_BYTES = 32;
// Budget fuer POST /challenge je IP, gleich wie in api/challengeStore.php.
const CHALLENGE_RATE_LIMIT_MAX = 20;
const CHALLENGE_RATE_LIMIT_WINDOW_MS = 60_000;

// Schluessel ist die Nonce (base64, kanonisch), nicht mehr (jobId, signer): Jede Challenge
// bleibt fuer sich offen, bis genau sie eingeloest wird oder ablaeuft. Die Reihenfolge der
// Map ist das Alter (aelteste zuerst).
/** @type {Map<string, { jobId: string, signer: string, expiresAt: number }>} */
const challenges = new Map();

// Opportunistic cleanup so abandoned challenges (requested but never
// redeemed) don't accumulate forever; cheap enough to run on every create.
function pruneExpired(now = Date.now()) {
  for (const [key, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(key);
  }
}

/**
 * Nonce aus dem Request-Body (Feld challenge): nur strikte Standard-base64 mit Padding und
 * genau 32 Byte, gleiche Strenge wie K5 und decodeChallengeNonce im Frontend. Gibt die Nonce
 * unveraendert zurueck oder null. Gleich parseChallengeNonce in api/challengeStore.php.
 */
function parseChallengeNonce(value) {
  if (typeof value !== 'string') return null;
  const bytes = decodeStrictBase64(value);
  if (!bytes || bytes.length !== CHALLENGE_NONCE_BYTES) return null;
  return value;
}

/**
 * Issues a fresh nonce for (jobId, signerPublicKey). Andere offene Challenges desselben Paars
 * bleiben, bis MAX_CHALLENGES_PER_SIGNER erreicht ist (dann faellt die aelteste weg).
 * @returns {{ challenge: string, expiresAt: number }} challenge is base64.
 */
function createChallenge(jobId, signerPublicKey, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  pruneExpired(now);
  let nonce;
  do nonce = crypto.randomBytes(CHALLENGE_NONCE_BYTES).toString('base64'); while (challenges.has(nonce));
  const expiresAt = now + ttlMs;
  capChallenges(jobId, signerPublicKey);
  challenges.set(nonce, { jobId, signer: signerPublicKey, expiresAt });
  return { challenge: nonce, expiresAt };
}

// Macht Platz fuer eine neue Challenge von (jobId, signer): zuerst je Signer, dann je Job,
// dann gesamt die aeltesten Eintraege entfernen. Abgelaufene hat pruneExpired() schon entfernt.
function capChallenges(jobId, signerPublicKey) {
  const ofSigner = [...challenges]
    .filter(([, entry]) => entry.jobId === jobId && entry.signer === signerPublicKey)
    .map(([key]) => key);
  for (let i = 0; i <= ofSigner.length - MAX_CHALLENGES_PER_SIGNER; i += 1) challenges.delete(ofSigner[i]);
  const ofJob = [...challenges].filter(([, entry]) => entry.jobId === jobId).map(([key]) => key);
  for (let i = 0; i <= ofJob.length - MAX_CHALLENGES_PER_JOB; i += 1) challenges.delete(ofJob[i]);
  for (const key of challenges.keys()) {
    if (challenges.size < MAX_CHALLENGES_TOTAL) break;
    challenges.delete(key);
  }
}

/**
 * Loest genau die Challenge `nonceB64` ein, wenn sie zu (jobId, signerPublicKey) gehoert, und
 * loescht sie dabei, unabhaengig davon, ob die folgende Signaturpruefung gelingt (kein Replay).
 * Eine Nonce, die kaputt, unbekannt, abgelaufen oder fuer einen anderen Job oder Signer
 * ausgestellt ist, ergibt null; eine fremde Nonce bleibt dabei unangetastet. Andere offene
 * Challenges desselben Signers bleiben immer.
 * @returns {{ nonce: string } | null}
 */
function consumeChallenge(jobId, signerPublicKey, nonceB64) {
  const nonce = parseChallengeNonce(nonceB64);
  if (!nonce) return null;
  const entry = challenges.get(nonce);
  if (!entry || entry.jobId !== jobId || entry.signer !== signerPublicKey) return null;
  challenges.delete(nonce);
  if (entry.expiresAt <= Date.now()) return null;
  return { nonce };
}

/**
 * Verifies that `signatureB64` is a valid ed25519 signature by
 * `signerPublicKey` over `skm:<purpose>:` plus the raw nonce bytes. Never
 * throws - any malformed base64/signature/public key is treated as an invalid
 * signature.
 */
// purpose bindet die Signatur an eine Aktion (token, decline, delete) und ist Pflicht: Ohne
// Praefix waere die Nachricht eine rohe 32-Byte-Nonce, gleich lang wie ein Transaktions-
// Hash. Ein manipuliertes Backend koennte sonst einen Tx-Hash als Challenge schicken und
// eine gueltige Transaktions-Signatur einsammeln. Ohne purpose ist keine Nachricht
// gueltig, eine Signatur fuer das Token gilt nie als Ablehnung und umgekehrt.
// Gleich in api/challengeStore.php und frontend/src/utils/multisigApi.js.
function challengeMessage(nonceB64, purpose) {
  // Strikt wie in PHP (base64_decode strict): die Nonce erzeugt das Backend selbst als Standard-base64.
  const nonce = decodeStrictBase64(String(nonceB64 || ''));
  if (!nonce || !nonce.length || typeof purpose !== 'string' || !purpose) return Buffer.alloc(0);
  return Buffer.concat([Buffer.from(`skm:${purpose}:`, 'utf8'), nonce]);
}

// Korrektur K5: Die Signatur wird strikt als Standard-base64 mit Padding dekodiert (wie PHP);
// vorher nahm Buffer.from(..., 'base64') auch Fremdzeichen und base64url an. Pruefung in signerAuth.js.
function verifyChallengeSignature(nonceB64, signatureB64, signerPublicKey, purpose) {
  const data = challengeMessage(nonceB64, purpose);
  if (!data.length) return false;
  return verifyChallenge(signerPublicKey, data, String(signatureB64 || ''));
}

module.exports = {
  createChallenge,
  consumeChallenge,
  parseChallengeNonce,
  verifyChallengeSignature,
  challengeMessage,
  MAX_CHALLENGES_TOTAL,
  MAX_CHALLENGES_PER_JOB,
  MAX_CHALLENGES_PER_SIGNER,
  CHALLENGE_NONCE_BYTES,
  CHALLENGE_RATE_LIMIT_MAX,
  CHALLENGE_RATE_LIMIT_WINDOW_MS,
};
