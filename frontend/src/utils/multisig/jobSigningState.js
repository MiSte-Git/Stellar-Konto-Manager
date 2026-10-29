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
