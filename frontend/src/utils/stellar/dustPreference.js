// Gemeinsame Einstellung: Kleinstzahlungen im Verlauf ausblenden (Standard: ja).
// Gilt fuer die Wallet-Startseite und den vollen Verlauf gleichermassen.
const HIDE_DUST_KEY = 'SKM_HIDE_DUST';

export function readHideDust() {
  try {
    return window.localStorage?.getItem(HIDE_DUST_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeHideDust(hide) {
  try {
    window.localStorage?.setItem(HIDE_DUST_KEY, hide ? '1' : '0');
  } catch {
    /* noop */
  }
}
