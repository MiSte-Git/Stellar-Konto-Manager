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
