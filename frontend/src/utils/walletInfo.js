// src/utils/walletInfo.js
/**
 * Creates a lookup map for wallet metadata (label, federation, flags).
 * The map stores both public keys (uppercased) and federation addresses (lowercased).
 * @param {Array} wallets
 * @returns {Map<string, {label: string, federation: string, compromised: boolean, deactivated: boolean}>}
 */
export function createWalletInfoMap(wallets = []) {
  const map = new Map();
  wallets.forEach((wallet) => {
    if (!wallet) return;
    const info = {
      label: String(wallet.label || '').trim(),
      federation: String(wallet.federation || wallet.federationAddress || '').trim(),
      compromised: !!wallet.compromised,
      deactivated: !!wallet.deactivated,
      isTestnet: !!wallet.isTestnet,
    };
    const address = String(wallet.address || '').trim();
    if (address) {
      map.set(address.toUpperCase(), info);
    }
    if (info.federation) {
      map.set(info.federation.toLowerCase(), info);
    }
  });
  return map;
}

/**
 * Looks up wallet metadata by either public key (G...) or federation address.
 * @param {Map} map - Result of createWalletInfoMap
 * @param {string} value - Address or federation input
 * @returns {object|null}
 */
export function findWalletInfo(map, value) {
  if (!map || typeof map.get !== 'function') return null;
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes('*') ? trimmed.toLowerCase() : trimmed.toUpperCase();
  return map.get(normalized) || null;
}
