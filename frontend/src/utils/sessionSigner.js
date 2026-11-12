import { Keypair } from '@stellar/stellar-sdk';
import { getSessionSecret, getSessionSecrets } from './sessionSecrets.js';

/**
 * Sucht unter den fuer dieses Konto gemerkten Session-Keys einen, der die Schwelle allein erreicht.
 * Gemerkt heisst: unter dem Konto abgelegt (getSessionSecrets) oder der eigene Master-Key des
 * Kontos, auch wenn er unter einem anderen Konto gemerkt wurde (getSessionSecret).
 *
 * Gilt nur, wenn der Key in der aktuellen Signer-Liste des Kontos steht (Ed25519, Gewicht > 0) und
 * sein Gewicht mindestens requiredWeight ist. Sonst leere Liste: der Aufrufer fragt den Key im
 * Dialog ab. Rueckgabe im Format des Key-Dialogs: [{ publicKey, weight, keypair }].
 */
export async function findSessionSigner({ accountId, signers, requiredWeight }) {
  if (!accountId) return [];
  const known = (Array.isArray(signers) ? signers : [])
    .filter((s) => s && (!s.type || s.type === 'ed25519_public_key'));
  if (!known.length) return [];
  const required = Number(requiredWeight) || 0;

  const secrets = [];
  const master = await getSessionSecret(accountId, accountId);
  if (master) secrets.push(master);
  secrets.push(...Object.values(await getSessionSecrets(accountId)));

  for (const secret of secrets) {
    let keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      continue; // unlesbarer Eintrag: kein Absturz, der Dialog fragt dann
    }
    const publicKey = keypair.publicKey();
    const match = known.find((s) => (s.key || s.public_key || s.publicKey) === publicKey);
    const weight = Number(match?.weight || 0);
    if (weight > 0 && weight >= required) return [{ publicKey, weight, keypair }];
  }
  return [];
}
