// Signaturstand eines Multisig-Jobs fuer den Ergebnisdialog: benoetigtes und
// gesammeltes Gewicht sowie die noch fehlenden Signer aus den Signer-Daten des
// Kontos (Horizon: { key, weight, type }). Nur ed25519-Signer, denn nur sie
// koennen einen Job interaktiv signieren (pre-auth/hash-Signer nicht).

function signerKey(signer) {
  if (typeof signer === 'string') return signer;
  return String(signer?.key || signer?.publicKey || signer?.public_key || '');
}

function isInteractiveSigner(signer) {
  const type = signer?.type;
  return !type || type === 'ed25519_public_key';
}

/**
 * @param {{ accountSigners?: object[], requiredWeight?: number, collectedSigners?: Array<string|{publicKey:string}> }} params
 * @returns {{ required: number, collected: number, missingSigners: { publicKey: string, weight: number }[] }}
 */
export function computeJobSigningState({ accountSigners = [], requiredWeight = 0, collectedSigners = [] } = {}) {
  const collectedKeys = new Set((Array.isArray(collectedSigners) ? collectedSigners : []).map(signerKey).filter(Boolean));
  const signers = (Array.isArray(accountSigners) ? accountSigners : [])
    .filter((s) => isInteractiveSigner(s) && signerKey(s) && Number(s?.weight || 0) > 0)
    .map((s) => ({ publicKey: signerKey(s), weight: Number(s.weight) }));
  const collected = signers.filter((s) => collectedKeys.has(s.publicKey)).reduce((sum, s) => sum + s.weight, 0);
  const missingSigners = signers.filter((s) => !collectedKeys.has(s.publicKey));
  return { required: Math.max(0, Number(requiredWeight) || 0), collected, missingSigners };
}

// Fehlt die Signatur dieses Kontos noch? Selbst berechnet aus signers und collectedSigners,
// weil nur das PHP-Backend missingSigners liefert (Node nicht). Nur Jobs, die noch auf
// Signaturen warten; in Endzustaenden und bei ready_to_submit muss niemand mehr signieren.
// Wer den Job abgelehnt hat, ebenfalls nicht.
export function needsSignatureFrom(job, accountId) {
  if (!job || !accountId) return false;
  if (String(job.status || '') !== 'pending_signatures') return false;
  const isSigner = (job.signers || []).some((s) => (s?.publicKey || '') === accountId && Number(s?.weight || 0) > 0);
  if (!isSigner) return false;
  // Wer abgelehnt hat, muss nicht mehr signieren.
  if ((job.declinedSigners || []).some((d) => (d?.publicKey || '') === accountId)) return false;
  return !(job.collectedSigners || []).some((s) => (s?.publicKey || '') === accountId);
}

// Endzustaende eines Jobs: nur diese koennen geloescht werden.
export const FINAL_JOB_STATUSES = new Set(['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected']);
