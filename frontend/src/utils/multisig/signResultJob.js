// Signieren aus dem Ergebnisdialog: Der Dialog kennt den Job aus der Backend-Antwort.
// Geprueft wird gegen expectedJob, also Konto, Netz und Hash der lokal gebauten Transaktion,
// damit ein vom Server getauschtes XDR nicht signiert wird.
import { mergeSignedXdr } from '../multisigApi.js';
import { decodeJobTransaction, verifyJobTransaction } from './verifyJobTransaction.js';

export const JOB_INTEGRITY_ERROR = 'job_integrity';

export async function signAndMergeResultJob({ jobToSign, keypairs, clientCollected, signers }) {
  const job = { ...jobToSign.expectedJob, txXdrCurrent: jobToSign.xdr };
  const tx = decodeJobTransaction(job);
  if (!verifyJobTransaction(job, tx).ok) {
    throw Object.assign(new Error(JOB_INTEGRITY_ERROR), { code: JOB_INTEGRITY_ERROR });
  }
  keypairs.forEach((kp) => {
    try { tx.sign(kp); } catch { /* noop */ }
  });
  return mergeSignedXdr({
    jobId: jobToSign.jobId,
    signedXdr: tx.toXDR(),
    clientCollected,
    signers,
    accessToken: jobToSign.accessToken,
  });
}
