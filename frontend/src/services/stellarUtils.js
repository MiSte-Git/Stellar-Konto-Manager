import {
  Horizon,
  StrKey,
  FederationServer,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Asset
} from '@stellar/stellar-sdk';

// 🌐 Horizon-Serverinstanz für das aktuelle Netzwerk
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;
const horizonServer = new Horizon.Server(HORIZON_URL);

/**
 * Gibt eine neue Horizon-Instanz zurück (z. B. für Testnet)
 * @param {string} url - Optionale URL, sonst Standard aus Umgebungsvariable
 * @returns {Server} - Horizon-Serverinstanz
 */
export function getHorizonServer(url = HORIZON_URL) {
  return new Server(url);
}

/**
 * Wandelt eine Federation-Adresse (user*domain.tld) in einen Public Key um
 * @param {string} federationAddress - z. B. user*lobstr.co
 * @returns {Promise<string>} - Der zugehörige Public Key (G...)
 * @throws {Error} - Wenn keine account_id gefunden wird
 */
export async function resolveFederationAddress(federationAddress) {
  const federationServer = new FederationServer('https://federation.stellar.org');
  const response = await federationServer.resolve(federationAddress);
  if (!response.account_id) throw new Error('error.noFederationId');
  return response.account_id;
}

/**
 * Holt alle Trustlines eines Accounts vom Horizon-Server
 * @param {string} publicKey - G... Public Key
 * @returns {Promise<Array>} - Liste der Trustlines mit Asset-Infos
 * @throws {Error} - Wenn ungültig oder nicht abrufbar
 */
export async function loadTrustlines(publicKey) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }

  try {
    const account = await horizonServer.loadAccount(publicKey);
    const balances = account.balances.filter(b => b.asset_type !== 'native');

    // Hole zusätzlich die Change-Trust-Operationen für createdAt
    const operations = await horizonServer
      .operations()
      .forAccount(publicKey)
      .order('desc')
      .limit(200)
      .call();

    const changeTrustOps = operations.records.filter(
      op => op.type === 'change_trust' && op.trustor === publicKey
    );

    return balances.map(asset => {
      const changeOp = changeTrustOps.find(op =>
        op.asset_code === asset.asset_code &&
        op.asset_issuer === asset.asset_issuer
      );
      return {
        assetCode: asset.asset_code,
        assetIssuer: asset.asset_issuer,
        assetType: asset.asset_type,
        assetBalance: asset.balance,
        limit: asset.limit,
        buyingLiabilities: asset.buying_liabilities,
        sellingLiabilities: asset.selling_liabilities,
        isAuthorized: asset.is_authorized,
        createdAt: changeOp?.created_at || 'unknown',
      };
    });
  } catch (error) {
    console.error('Error loading trustlines:', error);
    throw new Error('error.loadTrustlines');
  }
}

/**
 * Prüft, ob ein Secret Key zum erwarteten Public Key gehört
 * @param {string} secretKey - Secret Key (S...)
 * @param {string} expectedPublicKey - Erwarteter öffentlicher Key (G...)
 * @throws {Error} - Wenn Schlüssel nicht zusammenpassen
 */
export function assertKeyPairMatch(secretKey, expectedPublicKey) {
  const keypair = Keypair.fromSecret(secretKey);
  const derivedPublicKey = keypair.publicKey();
  if (derivedPublicKey !== expectedPublicKey) {
    throw new Error('secretKey.mismatch');
  }
}

/**
 * Löscht eine oder mehrere Trustlines durch Setzen des Limits auf 0
 * @param {Object} params - Enthält secretKey & zu löschende Trustlines
 * @param {string} params.secretKey - Secret Key des Wallets
 * @param {Array} params.trustlines - [{ assetCode, assetIssuer }]
 * @returns {Array} - Erfolgreich gelöschte Trustlines
 * @throws {Error} - Bei Horizon- oder Transaktionsfehlern
 */
export async function deleteTrustlines({ secretKey, trustlines }) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  
  if (trustlines.length === 0) {
    throw new Error("Keine gültigen Trustlines zum Löschen vorhanden.");
  }

  const account = await horizonServer.loadAccount(publicKey);
  const txBuilder = new TransactionBuilder(account, {
    fee: Number(await getBaseFee()),
    networkPassphrase: Networks.PUBLIC,
  });

  trustlines.forEach((tl) => {
    txBuilder.addOperation(
      Operation.changeTrust({
        asset: new Asset(tl.assetCode, tl.assetIssuer),
        limit: "0",
      })
    );
  });

  const transaction = txBuilder.setTimeout(60).build();
  transaction.sign(sourceKeypair);

  try {
    const result = await horizonServer.submitTransaction(transaction);

    return trustlines.map(tl => ({
      assetCode: tl.assetCode,
      assetIssuer: tl.assetIssuer,
      txId: result.id
    }));
  } catch (err) {
    const txCode = err.response?.data?.extras?.result_codes?.transaction;
    const opCodes = err.response?.data?.extras?.result_codes?.operations;
    const txHash = err.response?.data?.hash;

    const detail = opCodes?.[0] || txCode || 'unknown';
    const isRealError = detail !== 'op_success' && detail !== 'tx_success';

    if (!isRealError && txHash) {
      console.warn('⚠️ Horizon-Fehler gemeldet, aber tx evtl. erfolgreich:', txHash);
      return trustlines.map(tl => ({
        assetCode: tl.assetCode,
        assetIssuer: tl.assetIssuer,
        txId: txHash
      }));
    }

    console.error("❌ Trustline-Löschung fehlgeschlagen:", err);
    throw new Error('submitTransaction.failed:' + detail);
  }
}

/**
 * Prüft und löst Eingabe in Federation-Adresse oder Public Key auf
 * @param {string} input - Federation-Adresse oder Public Key
 * @returns {Promise<string>} - Gültiger öffentlicher Schlüssel (G...)
 * @throws {Error} - Bei leerer oder ungültiger Eingabe
 */
export async function resolveOrValidatePublicKey(input) {
  if (!input) throw new Error('resolveOrValidatePublicKey.empty');

  if (input.includes('*')) {
    return await resolveFederationAddress(input);
  }

  if (!StrKey.isValidEd25519PublicKey(input)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }

  return input;
}

/**
 * Findet doppelte Trustlines zwischen zwei Konten
 * (gleicher Asset-Code & -Issuer auf beiden Seiten)
 * @param {string} sourceKey - Public Key der Quelle
 * @param {string} destinationKey - Public Key des Ziels
 * @returns {Promise<Array>} - Gemeinsame Trustlines
 * @throws {Error} - Bei ungültigem Key
 */
export async function findDuplicateTrustlines(sourceKey, destinationKey) {
  if (!StrKey.isValidEd25519PublicKey(sourceKey) || !StrKey.isValidEd25519PublicKey(destinationKey)) {
    throw new Error('findDuplicateTrustlines.invalidKey');
  }

  const [sourceTrustlines, destTrustlines] = await Promise.all([
    loadTrustlines(sourceKey),
    loadTrustlines(destinationKey)
  ]);

  return sourceTrustlines.filter(source =>
    destTrustlines.some(dest =>
      dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
    )
  );
}

/**
 * Sortiert eine Liste von Trustlines nach Spalte und Richtung
 * @param {Array} trustlines - Die zu sortierende Trustline-Liste
 * @param {string} column - 'assetCode', 'assetIssuer', 'creationDate'
 * @param {string} direction - 'asc' oder 'desc'
 * @returns {Array} - Sortierte Liste
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
 * Gibt einen Ausschnitt der Trustlines für die aktuelle Seite zurück
 * @param {Array} trustlines - Gesamtliste
 * @param {number} currentPage - Aktuelle Seite (0-basiert)
 * @param {number} itemsPerPage - Anzahl pro Seite
 * @returns {Array} - Paginierte Liste
 */
export function paginateTrustlines(trustlines, currentPage, itemsPerPage) {
  const startIndex = currentPage * itemsPerPage;
  return trustlines.slice(startIndex, startIndex + itemsPerPage);
}

/**
 * Validiert, ob ein Secret Key gültig ist
 * @param {string} secret - Secret Key im S...-Format
 * @throws {Error} - Wenn ungültig oder leer
 */
export function validateSecretKey(secret) {
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) {
    throw new Error('validateSecretKey.invalid');
  }
}

/**
 * Holt die aktuelle Netzwerk-Fee (mode) vom Horizon-Server
 * @returns {Promise<string>} - Basis-Fee als String (z. B. "100")
 */
async function getBaseFee() {
  const feeStats = await horizonServer.feeStats();
  return Number(feeStats?.fee_charged?.mode || 100);
}

// Lädt Trustlines für eine gegebene Federation-Adresse oder Public Key
// und gibt sowohl die aufgelöste Adresse als auch die Trustlines zurück.
// Fehler werden als übersetzbare Error-Objekte zurückgegeben.
export async function handleSourceSubmit(sourceInput, t) {
  let publicKey = sourceInput;

  try {
    // Auflösung oder Validierung der Adresse (z. B. Federation → G...)
    publicKey = await resolveOrValidatePublicKey(sourceInput);
  } catch (resolveError) {
    // Fehler beim Auflösen (z. B. Federation-Adresse ungültig)
    throw new Error(t(resolveError.message));
  }

  try {
    const trustlines = await loadTrustlines(publicKey);
    return { publicKey, trustlines };
  } catch (loadError) {
    // Fehler beim Laden der Trustlines (z. B. Netzwerkproblem)
    throw new Error(t(loadError.message || 'loadTrustlines.failed'));
  }
}
/**
 * Löscht ausgewählte Trustlines und lädt danach die aktualisierte Liste.
 * Wird im Realmodus ausgeführt.
 */
export async function handleDeleteTrustlines({
  secretKey,
  trustlinesToDelete,
  sourcePublicKey,
  t,
  horizonServer,
}) {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const pubKeyFromSecret = keypair.publicKey();

  if (pubKeyFromSecret !== sourcePublicKey) {
    throw new Error(t('secretKey.mismatch'));
  }

  // Optional: Validierung der Trustlines hier ergänzen
  const deleted = await deleteTrustlines({ secretKey, trustlines: trustlinesToDelete });

  const updatedTrustlines = await loadTrustlines(sourcePublicKey);

  return {
    deleted,
    updatedTrustlines,
  };
}
/**
 * Teilt ein Array in gleich große Blöcke (Chunks) auf
 */
export function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
export async function deleteTrustlinesInChunks({ secretKey, trustlines, onProgress }) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const chunks = chunkArray(trustlines, 100);
  const allDeleted = [];
  let processed = 0;

  for (const chunk of chunks) {
    // Hole frische Live-Daten
    const liveTrustlines = await loadTrustlines(publicKey);

    // Prüfe, ob Trustlines aus dem Chunk wirklich noch existieren
    const stillValid = chunk.filter(tl =>
      liveTrustlines.some(existing =>
        existing.assetCode === tl.assetCode &&
        existing.assetIssuer === tl.assetIssuer &&
        existing.assetType !== 'native' &&
        parseFloat(existing.assetBalance) === 0 &&
        parseFloat(existing.buyingLiabilities || 0) === 0 &&
        parseFloat(existing.sellingLiabilities || 0) === 0
      )
    );

    if (stillValid.length === 0) {
      continue; // Keine gültigen Trustlines im Chunk
    }

    // Lade aktuellen Account (für korrekte Sequenznummer etc.)
    const account = await horizonServer.loadAccount(publicKey);
    const txBuilder = new TransactionBuilder(account, {
      fee: Number(await getBaseFee()),
      networkPassphrase: Networks.PUBLIC,
    });

    stillValid.forEach((tl) => {
      txBuilder.addOperation(
        Operation.changeTrust({
          asset: new Asset(tl.assetCode, tl.assetIssuer),
          limit: "0",
        })
      );
    });

    const transaction = txBuilder.setTimeout(60).build();
    transaction.sign(sourceKeypair);

    try {
      const result = await horizonServer.submitTransaction(transaction);

      const deletedChunk = stillValid.map(tl => ({
        assetCode: tl.assetCode,
        assetIssuer: tl.assetIssuer,
        txId: result.id
      }));

      allDeleted.push(...deletedChunk);
    } catch (err) {
      const txCode = err.response?.data?.extras?.result_codes?.transaction;
      const opCodes = err.response?.data?.extras?.result_codes?.operations;
      const txHash = err.response?.data?.hash;

      const detail = opCodes?.[0] || txCode || 'unknown';
      const isRealError = detail !== 'op_success' && detail !== 'tx_success';

      if (err.response?.data) {
        console.error('[DEBUG] Horizon Fehlerdaten:', JSON.stringify(err.response.data, null, 2));
      }

      if (!isRealError && txHash) {
        console.warn('⚠️ Horizon-Fehler gemeldet, aber tx evtl. erfolgreich:', txHash);
        const fallbackDeleted = stillValid.map(tl => ({
          assetCode: tl.assetCode,
          assetIssuer: tl.assetIssuer,
          txId: txHash
        }));
        allDeleted.push(...fallbackDeleted);
      } else {
        console.error("❌ Trustline-Löschung fehlgeschlagen:", err);
        throw new Error('submitTransaction.failed:' + detail);
      }
    }

    processed += chunk.length;
    if (typeof onProgress === 'function') {
      onProgress(processed, trustlines.length);
    }
  }

  if (allDeleted.length === 0) {
    throw new Error('noTrustlines');
  }

  return allDeleted;
}


