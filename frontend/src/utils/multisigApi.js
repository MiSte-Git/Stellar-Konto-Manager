import { Keypair } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { apiUrl } from './apiBase.js';

function ensureOk(res) {
  if (res.ok) return;
  const err = new Error('multisig.jobs.create_failed');
  err.status = res.status;
  throw err;
}

export async function createPendingMultisigJob(payload) {
  try {
    const r = await fetch(apiUrl('multisig/jobs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    ensureOk(r);
    return data;
  } catch (e) {
    const msg = e?.message || 'multisig.jobs.create_failed';
    throw new Error(msg);
  }
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
      throw err;
    }
    return data; // { challenge, expiresAt }
  } catch (e) {
    if (e?.status) throw e;
    throw new Error(e?.message || 'multisig.jobs.challenge_failed');
  }
}

// Signs a base64 challenge nonce with the given secret key, raw ed25519 (not a
// Stellar transaction - there is no XDR/network/sequence number involved,
// just a possession proof over server-issued random bytes). Returns the
// signature as base64, ready for getMultisigJobAccessToken().
export function signMultisigJobChallenge(secret, challengeB64) {
  const keypair = Keypair.fromSecret(secret);
  const nonceBytes = Buffer.from(String(challengeB64 || ''), 'base64');
  const signature = keypair.sign(nonceBytes);
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
export async function getMultisigJobAccessToken(jobId, signerPublicKey, signature) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(jobId)}/token`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: signerPublicKey || '', signature: signature || '' }),
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
    ensureOk(r);
    return data;
  } catch (e) {
    const msg = e?.message || 'multisig.jobs.merge_failed';
    throw new Error(msg);
  }
}
