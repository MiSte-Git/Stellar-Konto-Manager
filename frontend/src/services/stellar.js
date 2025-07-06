import { Horizon, StrKey, FederationServer } from '@stellar/stellar-sdk';

// Horizon-Serverinstanz (kann ggf. parametrisiert werden)
const HORIZON_URL = 'https://horizon.stellar.org';
const server = new Server(HORIZON_URL);

/**
 * Auflösung einer Federation-Adresse in einen Public Key
 * @param {string} federationAddress - z. B. user*lobstr.co
 * @returns {Promise<string>} - der zugehörige Public Key
 */
export async function resolveFederationAddress(federationAddress) {
  const federationServer = new FederationServer('https://federation.stellar.org');
  const response = await federationServer.resolve(federationAddress);
  if (!response.account_id) throw new Error('No account_id in federation response');
  return response.account_id;
}

/**
 * Holt alle Trustlines eines Kontos
 * @param {string} publicKey - öffentlicher Stellar-Schlüssel
 * @returns {Promise<Array>} - Liste der Trustlines (Assets)
 */
export async function loadTrustlines(publicKey) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('Invalid Stellar public key.');
  }

  try {
    const account = await server.loadAccount(publicKey);
    const balances = account.balances.filter(b => b.asset_type !== 'native');

    // Zusätzliche Informationen: created_at aus den Change Trust-Operationen
    const operations = await server
      .operations()
      .forAccount(publicKey)
      .order('desc')
      .limit(200)
      .call();

    const changeTrustOps = operations.records.filter(
      op => op.type === 'change_trust' && op.trustor === publicKey
    );

    const trustlines = balances.map(asset => {
      const changeOp = changeTrustOps.find(op =>
        op.asset_code === asset.asset_code &&
        op.asset_issuer === asset.asset_issuer
      );
      return {
        assetCode: asset.asset_code,
        assetIssuer: asset.asset_issuer,
        assetType: asset.asset_type,
        balance: asset.balance,
        limit: asset.limit,
        buyingLiabilities: asset.buying_liabilities,
        sellingLiabilities: asset.selling_liabilities,
        isAuthorized: asset.is_authorized,
        createdAt: changeOp?.created_at || 'unknown',
      };
    });

    return trustlines;
  } catch (error) {
    console.error('Error loading trustlines:', error);
    throw new Error('Failed to load trustlines: ' + error.message);
  }
}
