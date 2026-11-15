// Erkennung eines Secret Keys in beliebigem Text. Neutrale Stelle fuer alle, die Eingaben speichern oder
// anzeigen: Sammelzahlung, Entwurf von "Zahlung senden", Sendeschutz, Eingabe-Historie (F-4, Review Fable).
// Vorher lag die Funktion in utils/batchPayment/batchPaymentStore.js, das sie weiter exportiert.
import { StrKey } from '@stellar/stellar-sdk';
import { isClassicAccount, isPaymentDestination } from './stellar/addressType.js';

// Steckt in dem Wert irgendwo ein Secret Key? Nach Unicode-Normalisierung (NFKC, z.B.
// Vollbreite) und Grossschreibung werden gueltige G-/M-Adressen aus dem Text entfernt (auch mit
// Zusatz wie "G... (Konto A)"), danach alle Zeichen ausser Base32 (A-Z, 2-7): Trennzeichen,
// Satzzeichen, unsichtbare Zeichen und die Ziffern 0, 1, 8, 9. So wird auch ein Secret erkannt,
// das durch Punkt, Bindestrich oder eingefuegte Zeichen getrennt ist (z. B. in einer Federation-
// Adresse). Jeder Kandidat (S plus 55 Zeichen) wird mit Pruefsumme geprueft
// (StrKey.isValidEd25519SecretSeed); das verhindert Fehlalarme bei langen Domains oder Texten
// (Opus-Review S5, umgesetzt 14.11.2026).
const PUBLIC_KEY_RE = /[GM][A-Z2-7]{55,68}/g;
const SECRET_LENGTH = 56;

function stripPublicKeys(text) {
  return text.replace(PUBLIC_KEY_RE, (t) => {
    if (isPaymentDestination(t)) return ' ';
    // Laengerer Treffer (Adresse plus angehaengte Buchstaben): gueltige G-Adresse am Anfang?
    const g = t.slice(0, 56);
    return isClassicAccount(g) ? ` ${t.slice(56)}` : t;
  });
}

function hasSecretPattern(text) {
  const cleaned = stripPublicKeys(text.toUpperCase()).replace(/[^A-Z2-7]/g, '');
  for (let i = cleaned.indexOf('S'); i !== -1 && i + SECRET_LENGTH <= cleaned.length; i = cleaned.indexOf('S', i + 1)) {
    if (StrKey.isValidEd25519SecretSeed(cleaned.slice(i, i + SECRET_LENGTH))) return true;
  }
  return false;
}

export function containsSecretKey(value) {
  const raw = String(value ?? '').normalize('NFKC');
  if (!raw.trim()) return false;
  return hasSecretPattern(raw);
}
