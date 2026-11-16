import * as StellarSdk from '@stellar/stellar-sdk';
import { NETWORKS } from '../../config/networks.js';

async function accountExists(serverUrl, publicKey) {
  const server = new StellarSdk.Horizon.Server(serverUrl);
  try {
    await server.accounts().accountId(publicKey).call();
    return true;
  } catch (error) {
    if (error?.response?.status === 404) {
      return false;
    }
    // On unexpected errors, return null so callers can decide.
    return null;
  }
}

/**
 * Returns true only if the account exists on testnet and does not exist on mainnet.
 * This avoids labeling accounts as testnet when they also exist on mainnet.
 * Erst Mainnet, Testnet nur, wenn das Konto dort sicher nicht existiert: Fuer normale
 * Mainnet-Konten gibt es so keinen Testnet-Aufruf (vorher ein 404 in der Konsole bei
 * jedem neuen Eintrag im Kontoverlauf). Ergebnis unveraendert.
 */
export async function isTestnetAccount(publicKey) {
  const mainnetExists = await accountExists(NETWORKS.PUBLIC.horizonUrl, publicKey);
  if (mainnetExists !== false) return false;
  return (await accountExists(NETWORKS.TESTNET.horizonUrl, publicKey)) === true;
}

export function buildExplorerUrl(entry, value, netLabel, opts = {}) {
  if (!entry || !value) return '';
  const isTx = opts.type === 'tx';
  const isTestnet = netLabel === 'TESTNET';
  let tpl = '';
  if (isTx) {
    tpl = isTestnet
      ? (entry.testnetTxTemplate || entry.txTemplate || entry.urlTemplate || '')
      : (entry.txTemplate || entry.urlTemplate || '');
  } else {
    tpl = isTestnet
      ? (entry.testnetUrlTemplate || entry.urlTemplate || '')
      : (entry.urlTemplate || '');
  }
  if (!tpl) return '';
  return tpl
    .replace('{address}', value)
    .replace('{tx}', value);
}
