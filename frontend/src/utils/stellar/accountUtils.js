import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Checks the Horizon Testnet for the existence of the provided account.
 * Returns true when the account exists on the testnet, otherwise false.
 */
export async function isTestnetAccount(publicKey) {
  const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
  try {
    await server.accounts().accountId(publicKey).call();
    return true;
  } catch (error) {
    if (error?.response?.status === 404) {
      return false;
    }
    // Network errors or other unexpected responses fall back to false.
    return false;
  }
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
