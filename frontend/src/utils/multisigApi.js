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
