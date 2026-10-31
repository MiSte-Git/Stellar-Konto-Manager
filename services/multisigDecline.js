// Ablehnen eines Multisig-Jobs durch einen Signer. Gleiche Logik in api/multisigDecline.php.
//
// Eine Ablehnung ist zunaechst eine Information fuer die anderen Signer: Auf dem Netz
// stoppt sie die Transaktion nicht (dafuer gibt es den Widerruf per bumpSequence). Der
// Job selbst wird aber abgelehnt (Status rejected, nimmt keine Signaturen mehr an),
// sobald die Signer, die nicht abgelehnt haben, das noetige Gewicht nicht mehr
// erreichen koennen. Das Gewicht kommt aus den aktuellen Signern des Kontos (Horizon),
// nie aus der Anfrage.
'use strict';

/**
 * @param {object} job
 * @param {string} signerPk - der ablehnende Signer (Besitz per Challenge geprueft)
 * @param {Array<{publicKey: string, weight: number}>} liveSigners
 * @param {string} nowIso
 * @returns {{ declinedSigners: Array<{publicKey: string, at: string}>, status: string, possibleWeight: number }}
 */
function applyDecline(job, signerPk, liveSigners, nowIso) {
  const previous = Array.isArray(job?.declinedSigners) ? job.declinedSigners : [];
  const declinedSigners = previous.filter((d) => d && d.publicKey && d.publicKey !== signerPk);
  declinedSigners.push({ publicKey: signerPk, at: nowIso });
  const declinedKeys = new Set(declinedSigners.map((d) => d.publicKey));
  const possibleWeight = (Array.isArray(liveSigners) ? liveSigners : [])
    .filter((s) => s && Number(s.weight || 0) > 0 && !declinedKeys.has(s.publicKey))
    .reduce((sum, s) => sum + Number(s.weight || 0), 0);
  const required = Number(job?.requiredWeight || 0);
  const status = required > 0 && possibleWeight < required ? 'rejected' : String(job?.status || 'pending_signatures');
  return { declinedSigners, status, possibleWeight };
}

// Wer doch noch signiert hat, gilt nicht mehr als ablehnend.
function dropDeclinesOfCollected(declinedSigners, collectedSigners) {
  const collected = new Set((Array.isArray(collectedSigners) ? collectedSigners : []).map((c) => c?.publicKey));
  return (Array.isArray(declinedSigners) ? declinedSigners : []).filter((d) => d && !collected.has(d.publicKey));
}

module.exports = { applyDecline, dropDeclinesOfCollected };
