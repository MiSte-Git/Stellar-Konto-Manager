// Abschluss der Wege ohne lokale Signatur (Multisig-Job, XDR exportieren) fuer eine schon
// gebaute, unsignierte Transaktion. Gemeinsam fuer Liquidity Pools und Trading.
import { getNetworkConfig, passphraseFor } from '../../config/networks.js';
import { assertFlowNetwork } from '../globalNetwork.js';
import { createMultisigJobFromXdr } from '../multisigApi.js';
import { txHashHex } from '../stellar/txHash.js';

/**
 * Passt eine gebaute Transaktion zum Ablauf (Konto und Netz der Bestaetigung), und gilt das
 * globale Netz noch? Sonst Abbruch, bevor ein Job, ein XDR oder eine Signatur entsteht.
 * message: Fehlertext (i18n-Schluessel) bei abweichender Quelle oder Passphrase.
 */
export function assertTxMatchesFlow(tx, { network, accountId }, message = 'trading:assetSearch.multisig.contextChanged') {
  const source = String(tx?.source || '');
  if (!accountId || source !== accountId || tx?.networkPassphrase !== passphraseFor(network)) {
    throw new Error(message);
  }
  assertFlowNetwork(network);
}

/**
 * mode 'xdr': nur XDR und Hash, nichts wird angelegt oder gesendet.
 * mode 'job': Job per createMultisigJobFromXdr, ohne lokale Signatur.
 * Vorher: gilt das Netz des Ablaufs noch? (kein Job mit einer Transaktion aus einem
 * inzwischen verlassenen Netz). items: Zeilen fuer die Zusammenfassung im Ergebnisdialog.
 */
export async function finishUnsignedTx({ mode, tx, network, accountId, items = [] }) {
  assertFlowNetwork(network);
  const xdr = tx.toXDR();
  const validUntil = tx.timeBounds?.maxTime;
  if (mode === 'xdr') {
    return { hash: txHashHex(tx), xdr, validUntil, items };
  }
  const job = await createMultisigJobFromXdr({
    network: getNetworkConfig(network).backendId,
    accountId,
    txXdr: xdr,
  });
  return {
    id: job.id,
    hash: job.hash || txHashHex(tx),
    xdr: job.xdr,
    validUntil,
    requiredWeight: job.requiredWeight,
    collectedSigners: job.collectedSigners || [],
    accessToken: job.accessToken || '',
    items,
  };
}
