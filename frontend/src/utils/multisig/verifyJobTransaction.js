// Gemeinsame Pruefung vor jeder Aktion an einem Multisig-Job (Fix K1).
//
// Konto, Hash und Netz im Job-Datensatz sind Server-Angaben. Gezeigt und signiert wird aber
// die Transaktion aus dem XDR, und das Netz prueft die Signaturen gegen deren Quelle. Passt
// beides nicht zusammen, wuerde der Signer etwas anderes autorisieren, als der Job behauptet.
import { StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { passphraseFor } from '../../config/networks.js';
import { txHashHex } from '../stellar/txHash.js';
import { getJobSequenceInfo, parseJobNetwork } from './jobRevocation.js';

export function jobTxXdr(job) {
  return job?.txXdrCurrent || job?.txXdrOriginal || job?.txXdr || '';
}

// Bei unbekanntem Netz nur fuer die Anzeige dekodieren: Die Passphrase wirkt sich allein auf
// den Hash aus, und verifyJobTransaction meldet dieses Netz als Fehler. Signiert wird so nie.
export function decodeJobTransaction(job) {
  try {
    return TransactionBuilder.fromXDR(jobTxXdr(job), passphraseFor(parseJobNetwork(job?.network) || 'public'));
  } catch {
    return null;
  }
}

// issues: Liste von { code, expected?, actual? }, code ist
// undecodable | network_unknown | missing_job_data | hash_mismatch | account_mismatch.
export function verifyJobTransaction(job, decodedTx) {
  const network = parseJobNetwork(job?.network);
  const seqInfo = getJobSequenceInfo(decodedTx);
  const sourceAccountId = seqInfo?.sourceAccountId || '';
  const rawSource = String((decodedTx?.innerTransaction || decodedTx)?.source || '');
  const muxedSource = StrKey.isValidMed25519PublicKey(rawSource) ? rawSource : '';

  const issues = [];
  if (!seqInfo) issues.push({ code: 'undecodable' });
  if (!network) issues.push({ code: 'network_unknown', actual: String(job?.network ?? '') });
  if (!job?.txHash || !job?.accountId) {
    issues.push({ code: 'missing_job_data' });
  } else if (seqInfo) {
    // Der Hash haengt am Netz: Ohne bekanntes Netz sagt ein Vergleich nichts aus.
    const expectedHash = String(job.txHash).toLowerCase();
    const actualHash = network ? txHashHex(decodedTx) : expectedHash;
    if (actualHash !== expectedHash) issues.push({ code: 'hash_mismatch', expected: expectedHash, actual: actualHash });
    if (job.accountId !== sourceAccountId) issues.push({ code: 'account_mismatch', expected: job.accountId, actual: sourceAccountId });
  }
  return { ok: issues.length === 0, issues, network, sourceAccountId, muxedSource };
}
