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

// Load a pending multisig job by id
export async function getPendingMultisigJob(id) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(id)}`));
    const data = await r.json().catch(() => ({}));
    ensureOk(r);
    return data;
  } catch (e) {
    const msg = e?.message || 'multisig.jobs.get_failed';
    throw new Error(msg);
  }
}

// Merge a signed XDR into an existing job
export async function mergeSignedXdr(payload) {
  try {
    const r = await fetch(apiUrl(`multisig/jobs/${encodeURIComponent(payload.jobId)}/merge-signed-xdr`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedXdr: payload.signedXdr }),
    });
    const data = await r.json().catch(() => ({}));
    ensureOk(r);
    return data;
  } catch (e) {
    const msg = e?.message || 'multisig.jobs.merge_failed';
    throw new Error(msg);
  }
}
