// Liste der zuletzt genutzten Konten (localStorage `recentWallets`): Lesen und Normalisieren
// an einer Stelle (vorher je eine Kopie in main.jsx und useRecentWalletOptions.js).
// Gespeichert wird nur { publicKey, isTestnet }; der Kontotyp wird bei Bedarf aus der Adresse
// abgeleitet und nie gespeichert (ADR 0012, C-Konten vorbereiten).
import { RECENT_WALLETS_KEY } from './inputHistory.js';
import { baseAccountOf } from './stellar/addressType.js';

// Altes Format: reiner String. Neues Format: Objekt mit publicKey (oder address/value).
export function normalizeStoredWallet(entry) {
  if (typeof entry === 'string') {
    return { publicKey: entry, isTestnet: false };
  }
  if (!entry || typeof entry !== 'object') return null;
  const pk = entry.publicKey || entry.address || entry.value || '';
  if (!pk) return null;
  return { publicKey: pk, isTestnet: typeof entry.isTestnet === 'boolean' ? entry.isTestnet : undefined };
}

export function loadRecentWalletsFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_WALLETS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeStoredWallet).filter(Boolean);
  } catch {
    return [];
  }
}

// Schluessel fuer Label- und Netzsuche: Eine gueltige M-Adresse zaehlt zu ihrem Basiskonto,
// alles andere bleibt, wie es ist (auch ungueltige Eingaben).
export function walletLookupKey(address) {
  return baseAccountOf(address) || address;
}
