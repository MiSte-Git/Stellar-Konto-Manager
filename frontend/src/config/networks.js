// Zentrale Netzwerk-Registry (Single Source of Truth fuer Passphrase und Endpunkte).
//
// Jede Stelle, die eine Horizon-URL, Passphrase, Friendbot- oder RPC-URL braucht,
// holt sie hier ab statt sie hart zu codieren. Dadurch faellt ein unbekanntes
// Netz nicht mehr still per Ternary auf Mainnet zurueck.
//
// Futurenet ist vorbereitet, aber deaktiviert (enabled: false). Zum Aktivieren:
//   1. enabled auf true setzen (hier, in services/stellarNetworks.js und api/stellarNetworks.php)
//   2. Futurenet-Hosts in BASE_CONNECT_SRC (services/securityHeaders.js) aufnehmen
//   3. Netzwahl-UI (main.jsx Dev-Schalter, MultisigEditPage NetworkSelector) erweitern
//   4. Stellen mit binaerer isTestnet-Logik pruefen (Labels, Explorer-Links)
//   5. i18n-Texte fuer das Netz ergaenzen
// Quelle der Werte: https://developers.stellar.org/docs/networks
import { Networks } from '@stellar/stellar-sdk';

export const NETWORKS = Object.freeze({
  PUBLIC: Object.freeze({
    id: 'PUBLIC',
    backendId: 'public',
    label: 'Mainnet',
    passphrase: Networks.PUBLIC,
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: null, // Mainnet: nur Drittanbieter-RPC
    friendbotUrl: null,
    expertSlug: 'public',
    isTest: false,
    enabled: true,
  }),
  TESTNET: Object.freeze({
    id: 'TESTNET',
    backendId: 'testnet',
    label: 'Testnet',
    passphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    friendbotUrl: 'https://friendbot.stellar.org',
    expertSlug: 'testnet',
    isTest: true,
    enabled: true,
  }),
  FUTURENET: Object.freeze({
    id: 'FUTURENET',
    backendId: 'futurenet',
    label: 'Futurenet',
    passphrase: Networks.FUTURENET,
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    friendbotUrl: 'https://friendbot-futurenet.stellar.org',
    expertSlug: null, // StellarExpert-Abdeckung vor Aktivierung pruefen
    isTest: true,
    enabled: false,
  }),
});

export const DEFAULT_NETWORK_ID = 'PUBLIC';

export const ENABLED_NETWORK_IDS = Object.freeze(
  Object.values(NETWORKS).filter((n) => n.enabled).map((n) => n.id)
);

const ALIASES = Object.freeze({
  PUBLIC: 'PUBLIC',
  PUBLICNET: 'PUBLIC',
  PUBNET: 'PUBLIC',
  MAINNET: 'PUBLIC',
  TESTNET: 'TESTNET',
  TEST: 'TESTNET',
  FUTURENET: 'FUTURENET',
});

/** Bekannte Netz-ID ('PUBLIC' | 'TESTNET' | 'FUTURENET') oder null. Gross-/Kleinschreibung egal. */
export function normalizeNetworkId(raw) {
  const key = String(raw ?? '').trim().toUpperCase();
  return ALIASES[key] || null;
}

export function isNetworkEnabled(raw) {
  const id = normalizeNetworkId(raw);
  return !!(id && NETWORKS[id].enabled);
}

/**
 * Konfiguration fuer ein Netz. Unbekannte oder leere Werte ergeben PUBLIC
 * (bisheriges Verhalten der verstreuten Ternaries). Bekannte, aber deaktivierte
 * Netze werden geliefert, wenn sie explizit angefragt werden.
 */
export function getNetworkConfig(raw) {
  const id = normalizeNetworkId(raw);
  return NETWORKS[id || DEFAULT_NETWORK_ID];
}

export const horizonUrlFor = (raw) => getNetworkConfig(raw).horizonUrl;
export const passphraseFor = (raw) => getNetworkConfig(raw).passphrase;
export const isTestNetwork = (raw) => getNetworkConfig(raw).isTest;

export function friendbotUrlFor(raw) {
  const cfg = getNetworkConfig(raw);
  if (!cfg.friendbotUrl) throw new Error(`friendbot.unavailable:${cfg.id}`);
  return cfg.friendbotUrl;
}

/** Netz-ID passend zu einer Passphrase (z. B. aus SEP-7 oder Horizon-Root) oder null. */
export function networkIdForPassphrase(passphrase) {
  const hit = Object.values(NETWORKS).find((n) => n.passphrase === passphrase);
  return hit ? hit.id : null;
}

/**
 * Aktuell gewaehltes Netz aus localStorage (SKM_NETWORK). Nicht aktivierte oder
 * unbekannte Werte ergeben PUBLIC, damit ein manipulierter Wert kein
 * deaktiviertes Netz einschaltet.
 */
export function readStoredNetworkId() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('SKM_NETWORK') : null;
    return isNetworkEnabled(raw) ? normalizeNetworkId(raw) : DEFAULT_NETWORK_ID;
  } catch {
    return DEFAULT_NETWORK_ID;
  }
}
