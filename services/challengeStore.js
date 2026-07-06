// Challenge-response nonce store for the multisig job token endpoint.
//
// Closes finding H1 (Ultrareview 2026-07-06): the token endpoint used to hand
// out a job's accessToken to anyone who merely *named* a public key that
// happened to be an active signer on-chain - no proof the caller actually
// holds that key's private half was required, and signer lists are public on
// Horizon. This module adds the missing possession proof: the caller must
// first request a short-lived, single-use nonce for (jobId, signerPublicKey),
// then sign it with the claimed key before a token is issued.
//
// In-memory only (no disk persistence, unlike the job store): server.js is a
// single long-running process, and a challenge is only ever useful for ~60s -
// losing pending challenges on a restart just means the client requests a
// fresh one, which is a non-issue.
const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');

const DEFAULT_TTL_MS = 60_000;

/** @type {Map<string, { nonce: string, expiresAt: number }>} */
const challenges = new Map();

function challengeKey(jobId, signerPublicKey) {
  return `${jobId}:${signerPublicKey}`;
}

// Opportunistic cleanup so abandoned challenges (requested but never
// redeemed) don't accumulate forever; cheap enough to run on every create.
function pruneExpired(now = Date.now()) {
  for (const [key, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(key);
  }
}

/**
 * Issues a fresh nonce for (jobId, signerPublicKey), overwriting any
 * still-pending challenge for the same pair (only the newest one is valid).
 * @returns {{ challenge: string, expiresAt: number }} challenge is base64.
 */
function createChallenge(jobId, signerPublicKey, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  pruneExpired(now);
  const nonce = crypto.randomBytes(32).toString('base64');
  const expiresAt = now + ttlMs;
  challenges.set(challengeKey(jobId, signerPublicKey), { nonce, expiresAt });
  return { challenge: nonce, expiresAt };
}

/**
 * Atomically retrieves and deletes the pending challenge for (jobId,
 * signerPublicKey) - single-use regardless of whether the signature that
 * follows turns out to be valid, so a captured nonce+signature pair can never
 * be replayed even against a retried request.
 * @returns {{ nonce: string } | null} null if none pending or it expired.
 */
function consumeChallenge(jobId, signerPublicKey) {
  const key = challengeKey(jobId, signerPublicKey);
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return { nonce: entry.nonce };
}

/**
 * Verifies that `signatureB64` is a valid ed25519 signature by
 * `signerPublicKey` over the raw bytes of `nonceB64`. Never throws - any
 * malformed base64/signature/public key is treated as an invalid signature.
 */
function verifyChallengeSignature(nonceB64, signatureB64, signerPublicKey) {
  try {
    const keypair = Keypair.fromPublicKey(signerPublicKey);
    const data = Buffer.from(String(nonceB64 || ''), 'base64');
    const signature = Buffer.from(String(signatureB64 || ''), 'base64');
    if (!data.length || !signature.length) return false;
    return keypair.verify(data, signature);
  } catch {
    return false;
  }
}

module.exports = { createChallenge, consumeChallenge, verifyChallengeSignature };
