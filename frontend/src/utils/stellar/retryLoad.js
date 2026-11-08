// Wiederholen eines LADENDEN Aufrufs (GET) mit Wartezeit. Nie fuer einen POST (Senden) und nie
// zum Neubauen einer Transaktion: Wiederholt wird nur, was nichts veraendert (z.B. das Laden
// des Empfaengerkontos fuer die Memo-Pruefung nach SEP-29).
import { isAccountRequiresMemoError } from './memoRequired.js';

export const LOAD_BACKOFF_DELAYS_MS = [1000, 2000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kurzzeitiger Fehler beim Laden, bei dem eine Wiederholung sinnvoll sein kann: keine Antwort
 * (Netzfehler, Zeitueberschreitung) oder HTTP 408/429/5xx. Nie der Fehler "Konto verlangt ein Memo"
 * und keine 4xx-Antwort (dort aendert eine Wiederholung nichts).
 */
export function isTransientLoadError(err) {
  if (isAccountRequiresMemoError(err)) return false;
  const status = Number(err?.response?.status) || 0;
  if (!status) return true;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Ruft load() hoechstens delaysMs.length + 1 Mal auf (Wartezeit dazwischen). Der letzte Fehler
 * wird weitergereicht. load muss ein reines Laden sein.
 */
export async function loadWithBackoff(load, { delaysMs = LOAD_BACKOFF_DELAYS_MS, sleep = defaultSleep, isRetryable = isTransientLoadError } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (err) {
      if (attempt >= delaysMs.length || !isRetryable(err)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}
