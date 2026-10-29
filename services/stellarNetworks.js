// Netzwerk-Registry fuer das Node-Backend. Spiegel von
// frontend/src/config/networks.js und api/stellarNetworks.php
// (Paritaet geprueft durch test/stellarNetworks.test.js).
//
// Backend-IDs sind kleingeschrieben ('public' | 'testnet' | 'futurenet'), so wie
// sie in Multisig-Jobs gespeichert werden. normalizeNetwork() liefert nur
// aktivierte Netze, alles andere ergibt null (-> invalid_network).
// Futurenet ist vorbereitet, aber deaktiviert.
const StellarSdk = require('@stellar/stellar-sdk');

const NETWORKS = Object.freeze({
  public: Object.freeze({
    id: 'public',
    passphrase: StellarSdk.Networks.PUBLIC,
    horizonUrl: 'https://horizon.stellar.org',
    enabled: true,
  }),
  testnet: Object.freeze({
    id: 'testnet',
    passphrase: StellarSdk.Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    enabled: true,
  }),
  futurenet: Object.freeze({
    id: 'futurenet',
    passphrase: StellarSdk.Networks.FUTURENET,
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    enabled: false,
  }),
});

const ALIASES = Object.freeze({
  public: 'public',
  publicnet: 'public',
  testnet: 'testnet',
  test: 'testnet',
  futurenet: 'futurenet',
});

/** Aktiviertes Backend-Netz ('public' | 'testnet') oder null. */
function normalizeNetwork(raw) {
  const id = ALIASES[String(raw ?? '').trim().toLowerCase()];
  return id && NETWORKS[id].enabled ? id : null;
}

/**
 * Konfiguration fuer ein bereits normalisiertes/gespeichertes Netz.
 * Wirft bei unbekanntem Wert, statt still auf ein anderes Netz zu fallen.
 */
function getNetworkConfig(id) {
  const cfg = NETWORKS[ALIASES[String(id ?? '').trim().toLowerCase()]];
  if (!cfg) throw new Error(`unknown_network:${id}`);
  return cfg;
}

const passphraseFor = (id) => getNetworkConfig(id).passphrase;
const horizonUrlFor = (id) => getNetworkConfig(id).horizonUrl;

/**
 * Netz aus Query-Parametern von Trade/Konto-Abfragen (z. B. ?network=TESTNET).
 * Fehlend, unbekannt oder deaktiviert -> 'public' (bisheriges Verhalten).
 */
function networkFromQuery(raw) {
  return normalizeNetwork(raw) || 'public';
}

module.exports = {
  NETWORKS,
  normalizeNetwork,
  getNetworkConfig,
  passphraseFor,
  horizonUrlFor,
  networkFromQuery,
};
