// Liste der zuletzt genutzten Konten (localStorage `recentWallets`): Lesen und Normalisieren
// an einer Stelle (vorher je eine Kopie in main.jsx und useRecentWalletOptions.js).
// Gespeichert wird nur { publicKey, isTestnet }; der Kontotyp wird bei Bedarf aus der Adresse
// abgeleitet und nie gespeichert (ADR 0012, C-Konten vorbereiten).
import { RECENT_WALLETS_KEY, readHistoryArray } from './inputHistory.js';
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

// Ueber readHistoryArray: Eintraege mit Secret Key fallen weg, der Altbestand wird bereinigt (F-4).
export function loadRecentWalletsFromStorage() {
  return readHistoryArray(RECENT_WALLETS_KEY).map(normalizeStoredWallet).filter(Boolean);
}

// Schluessel fuer Label- und Netzsuche: Eine gueltige M-Adresse zaehlt zu ihrem Basiskonto,
// alles andere bleibt, wie es ist (auch ungueltige Eingaben).
export function walletLookupKey(address) {
  return baseAccountOf(address) || address;
}

// T7: Steht das Konto im Verlauf mit dem Etikett Testnet (gibt es nur im Testnet)? Dann bietet der
// Kopf auf Mainnet einen Wechsel an. Das Etikett kann veraltet sein, deshalb nie automatisch wechseln.
export function isTestnetOnlyRecent(recentWallets, address) {
  if (!address) return false;
  const key = walletLookupKey(address);
  return (recentWallets || []).some((entry) => entry?.isTestnet === true && walletLookupKey(entry.publicKey || '') === key);
}
