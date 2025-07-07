import { Horizon, StrKey, FederationServer } from '@stellar/stellar-sdk';

// Horizon-Serverinstanz (kann ggf. parametrisiert werden)
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;
const horizonServer = new Horizon.Server(HORIZON_URL);

/*
* Optional für spätere Flexibilität: Falls du später auch das Testnet oder andere Horizon-URLs nutzen willst
*/
export function getHorizonServer(url = HORIZON_URL) {
  return new Horizon.Server(url);
}

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
    const account = await horizonServer.loadAccount(publicKey);
    const balances = account.balances.filter(b => b.asset_type !== 'native');

    // Zusätzliche Informationen: created_at aus den Change Trust-Operationen
    const operations = await horizonServer
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
/**
 * Validiert oder löst eine Eingabeadresse (Federation oder Public Key) zu einem gültigen Public Key auf
 * @param {string} input - Eingabe (z. B. GABC... oder user*lobstr.co)
 * @returns {Promise<string>} - Gültiger öffentlicher Stellar-Schlüssel
 */
export async function resolveOrValidatePublicKey(input) {
  if (!input) {
    throw new Error('resolveOrValidatePublicKey.empty');
  }

  if (input.includes('*')) {
    return await resolveFederationAddress(input);
  }

  if (!StrKey.isValidEd25519PublicKey(input)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }

  return input;
}
/**
 * Vergleicht zwei Stellar-Konten und findet gemeinsame Trustlines (gleicher Asset-Code & Issuer)
 * @param {string} sourceKey - öffentlicher Schlüssel der Quelle
 * @param {string} destinationKey - öffentlicher Schlüssel des Ziels
 * @returns {Promise<Array>} - Liste der doppelten Trustlines
 */
export async function findDuplicateTrustlines(sourceKey, destinationKey) {
  if (!StrKey.isValidEd25519PublicKey(sourceKey) || !StrKey.isValidEd25519PublicKey(destinationKey)) {
    throw new Error('findDuplicateTrustlines.invalidKey');
  }

  const [sourceTrustlines, destTrustlines] = await Promise.all([
    loadTrustlines(sourceKey),
    loadTrustlines(destinationKey)
  ]);

  const duplicates = sourceTrustlines.filter(source =>
    destTrustlines.some(dest =>
      dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
    )
  );

  return duplicates;
}
/**
 * Sortiert eine Liste von Trustlines nach Spalte und Richtung
 * @param {Array} trustlines - Die zu sortierende Trustline-Liste
 * @param {string} column - 'assetCode', 'assetIssuer' oder 'creationDate'
 * @param {string} direction - 'asc' oder 'desc'
 * @returns {Array} - Sortierte Trustline-Liste
 */
export function sortTrustlines(trustlines, column, direction = 'asc') {
  const isAsc = direction === 'asc' ? 1 : -1;
  return [...trustlines].sort((a, b) => {
    if (column === 'assetCode') {
      return a.assetCode.localeCompare(b.assetCode) * isAsc;
    } else if (column === 'assetIssuer') {
      return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
    } else if (column === 'creationDate') {
      const dateA = a.creationDate ? new Date(a.creationDate).getTime() : (isAsc ? Infinity : -Infinity);
      const dateB = b.creationDate ? new Date(b.creationDate).getTime() : (isAsc ? Infinity : -Infinity);
      return (dateA - dateB) * isAsc;
    }
    return 0;
  });
}
/**
 * Gibt die Trustlines für eine bestimmte Seite zurück
 * @param {Array} trustlines - Gesamtliste
 * @param {number} currentPage - Aktuelle Seite (0-basiert)
 * @param {number} itemsPerPage - Anzahl pro Seite
 * @returns {Array} - Ausschnitt der Trustlines
 */
export function paginateTrustlines(trustlines, currentPage, itemsPerPage) {
  const startIndex = currentPage * itemsPerPage;
  return trustlines.slice(startIndex, startIndex + itemsPerPage);
}
/**
 * Validiert einen Stellar Secret Key
 * @param {string} secret - geheimer Schlüssel (Secret Seed)
 * @throws {Error} - falls leer oder ungültig
 */
export function validateSecretKey(secret) {
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) {
    throw new Error('validateSecretKey.invalid');
  }
}


