import { Buffer } from 'buffer';
import { apiUrl } from './apiBase.js';
import { backendErrorMessage } from './multisigErrors.js';
import { submitReasonText } from './multisig/submitReason.js';
import { keypairFromSecret, signChallengeMessage } from './signers/keyMaterial.js';

function ensureOk(res) {
  if (res.ok) return;
  const err = new Error('multisig.jobs.create_failed');
  err.status = res.status;
  throw err;
}

// Load a pending multisig job by id. `accessToken` is the per-job token returned
// when the job was created/listed (B3) - required by the backend to view the job.
export async function getPendingMultisigJob(id, accessToken) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(id)}`), {
      headers: accessToken ? { 'x-job-token': accessToken } : undefined,
    });
    const data = await r.json().catch(() => ({}));
    ensureOk(r);
    return data;
  } catch (e) {
    const msg = e?.message || 'multisig.jobs.get_failed';
    throw new Error(msg);
  }
}

// Requests a short-lived (60s), single-use nonce for (jobId, signerPublicKey) -
// the first half of the possession proof the /token endpoint requires (H1
// fix): the caller must sign this nonce with the matching private key before
// a token is issued, so merely naming an active signer's public key is no
// longer sufficient on its own.
export async function getMultisigJobChallenge(jobId, signerPublicKey) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(jobId)}/challenge`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: signerPublicKey || '' }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data?.error || 'multisig.jobs.challenge_failed');
      err.status = r.status;
      // 429 too_many_requests (C2): Wartezeit fuer die Meldung im Job-Detail.
      if (Number.isFinite(data?.retryAfter)) err.retryAfter = data.retryAfter;
      throw err;
    }
    return data; // { challenge, expiresAt }
  } catch (e) {
    if (e?.status) throw e;
    throw new Error(e?.message || 'multisig.jobs.challenge_failed');
  }
}

// Erlaubte Zwecke einer Challenge-Signatur, muessen zu den Backend-Endpunkten passen.
export const CHALLENGE_PURPOSES = Object.freeze(['token', 'decline', 'delete']);

// Signs a base64 challenge nonce with the given secret key, raw ed25519 (not a
// Stellar transaction - there is no XDR/network/sequence number involved,
// just a possession proof over server-issued random bytes). Returns the
// signature as base64, ready for getMultisigJobAccessToken()/declineMultisigJob()/
// deleteMultisigJob().
// purpose ist Pflicht und bindet die Signatur an eine Aktion: signiert wird immer
// `skm:<purpose>:` plus Nonce, nie die Nonce allein. Eine rohe 32-Byte-Nonce waere gleich
// lang wie ein Transaktions-Hash, ein manipuliertes Backend koennte sonst einen Tx-Hash
// als Challenge schicken und so eine gueltige Transaktions-Signatur erhalten.
// Gleich wie challengeMessage in services/challengeStore.js und api/challengeStore.php.
// F-6 (Review Fable): Laenge der Nonce, wie sie das Backend erzeugt (32 Zufallsbytes).
export const CHALLENGE_NONCE_BYTES = 32;

/**
 * Nonce aus der Challenge des Servers, nur als strikte base64 mit genau 32 Byte (gleiche Strenge wie K5 im
 * Backend, decodeStrictBase64 in services/signerAuth.js: Laenge durch 4 teilbar, nur Standardalphabet,
 * Padding nur am Ende, kanonische Form). Sonst Fehler multisig.jobs.invalid_challenge, es wird nichts signiert.
 * Grund: ADR 0004 sagt, keine signierte Nachricht sei 32 Byte lang. Das haengt sonst am Server: Mit einer
 * 22-Byte-Nonce waere skm:token: plus Nonce genau 32 Byte, so lang wie ein Transaktions-Hash.
 */
export function decodeChallengeNonce(challengeB64) {
  const invalid = () => new Error('multisig.jobs.invalid_challenge');
  if (typeof challengeB64 !== 'string' || challengeB64.length === 0 || challengeB64.length % 4 !== 0) throw invalid();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(challengeB64)) throw invalid();
  const bytes = Buffer.from(challengeB64, 'base64');
  if (bytes.toString('base64') !== challengeB64 || bytes.length !== CHALLENGE_NONCE_BYTES) throw invalid();
  return bytes;
}

export function signMultisigJobChallenge(secret, challengeB64, purpose) {
  if (!CHALLENGE_PURPOSES.includes(purpose)) {
    throw new Error(`multisig.jobs.invalid_challenge_purpose: ${purpose || '-'}`);
  }
  // Erst die Nonce pruefen, dann den Key: bei ungueltiger Challenge wird nichts signiert.
  const nonceBytes = decodeChallengeNonce(challengeB64);
  const keypair = keypairFromSecret(secret);
  const data = Buffer.concat([Buffer.from(`skm:${purpose}:`, 'utf8'), nonceBytes]);
  const signature = signChallengeMessage(keypair, data);
  return Buffer.from(signature).toString('base64');
}

// Fetches the per-job access token for a caller who proves BOTH that they
// hold the private key for signerPublicKey (a valid `signature` over a
// getMultisigJobChallenge() nonce, H1 fix) AND is verified server-side as an
// active signer (weight > 0) of the job's account - checked against the
// account's live Horizon signer list, never trusted from client input. This is
// the only way to obtain a job's token, since the job list response no longer
// includes it (it used to, which let anyone who knew a public accountId read
// every pending job's token straight out of the list).
// challenge ist die Nonce aus getMultisigJobChallenge(), ueber die signiert wurde: Das Backend
// verbraucht nur genau diese, andere offene Challenges desselben Signers bleiben.
export async function getMultisigJobAccessToken(jobId, signerPublicKey, signature, challenge) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(jobId)}/token`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: signerPublicKey || '', signature: signature || '', challenge: challenge || '' }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data?.error || 'multisig.jobs.token_failed');
      err.status = r.status;
      throw err;
    }
    return data?.accessToken || null;
  } catch (e) {
    if (e?.status) throw e;
    const err = new Error(e?.message || 'multisig.jobs.token_failed');
    throw err;
  }
}

// Merge a signed XDR into an existing job. `payload.accessToken` is the per-job
// token (B3) - required by the backend to merge a signature into the job.
export async function mergeSignedXdr(payload) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(payload.jobId)}/merge-signed-xdr`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(payload.accessToken ? { 'x-job-token': payload.accessToken } : {}),
      },
      body: JSON.stringify({
        signedXdr: payload.signedXdr,
        clientCollected: payload.clientCollected,
        signers: payload.signers,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(backendErrorMessage(data?.error, 'multisig.jobs.merge_failed'));
      err.status = r.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e?.status) throw e;
    const msg = e?.message || 'multisig.jobs.merge_failed';
    throw new Error(msg);
  }
}

// Legt einen Multisig-Job aus einem unsignierten XDR an (gleicher Request wie in
// ListTrustlines/SendPaymentPage). network: 'testnet' | 'public'.
export async function createMultisigJobFromXdr({ network, accountId, txXdr }) {
  const r = await fetch(apiUrl('multisig/jobs'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network, accountId, txXdr, createdBy: 'local' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(backendErrorMessage(data?.error, 'multisig.jobs.create_failed'));
  const id = data?.id || data?.jobId || '';
  if (!id) throw new Error('multisig.jobs.create_failed');
  return {
    id,
    hash: data?.txHash || data?.tx_hash || '',
    xdr: data?.txXdrCurrent || data?.tx_xdr_current || txXdr,
    // Signaturstand und Zugriffstoken, soweit das Backend sie liefert (Ergebnisdialog, "Zum Job")
    requiredWeight: Number(data?.requiredWeight || 0) || null,
    collectedSigners: Array.isArray(data?.collectedSigners) ? data.collectedSigners : [],
    accessToken: data?.accessToken || '',
    // R-2: Status und Grund aus der Antwort (sendet das Backend beim Anlegen, steht hier der Ausgang).
    status: typeof data?.status === 'string' ? data.status : '',
    submitReason: submitReasonText(data?.submittedResult),
  };
}

async function jobRequest(url, options, fallbackError) {
  try {
    const r = await fetch(url, options);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data?.error || fallbackError);
      err.status = r.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e?.status) throw e;
    throw new Error(e?.message || fallbackError);
  }
}

// Ablehnen: signature ist die mit dem Signer-Key signierte Challenge (wie beim Token),
// damit das Backend weiss, welcher Signer ablehnt; challenge ist deren Nonce. Antwort: { ok, status, declinedSigners }.
export async function declineMultisigJob(jobId, signerPublicKey, signature, challenge) {
  return jobRequest(apiUrl(`multisig/jobs/${encodeURIComponent(jobId)}/decline`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signer: signerPublicKey || '', signature: signature || '', challenge: challenge || '' }),
  }, 'multisig.jobs.decline_failed');
}

// Einzelnen Job im Endzustand loeschen (C1): signature ist die mit dem Signer-Key und Zweck
// `delete` signierte Challenge, wie beim Ablehnen, challenge deren Nonce. Das Backend loescht nur fuer aktuelle
// Signer des Job-Kontos (live geprueft), das Job-Token reicht dafuer nicht.
export async function deleteMultisigJob(jobId, signerPublicKey, signature, challenge) {
  return jobRequest(apiUrl(`multisig/jobs/${encodeURIComponent(jobId)}/delete`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signer: signerPublicKey || '', signature: signature || '', challenge: challenge || '' }),
  }, 'multisig.jobs.delete_failed');
}
