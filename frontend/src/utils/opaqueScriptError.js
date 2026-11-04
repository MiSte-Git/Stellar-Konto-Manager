// Fehler, die nicht aus SKM stammen, nicht als Fehlermeldung in der App anzeigen.
//
// 1. Maskierte Fehler: Fehler aus fremden Skripten meldet der Browser aus Datenschutzgruenden
//    nur als "Script error." ohne Quelle, Zeile und Error-Objekt.
// 2. Eingeschleuste Skripte: Browser-Erweiterungen und eingebaute Wallets (z. B. Brave Wallet auf
//    iOS, window.ethereum) fuehren Code direkt im Dokument aus. Der Fehler nennt dann die Seiten-URL
//    als Quelle. SKM selbst laedt Skripte nur als Dateien unter <base>assets/ (CSP script-src 'self',
//    kein Inline-Code), deshalb zaehlt in Produktion nur ein Fehler mit Quelle unter assetPrefix
//    oder mit einem Stack, der dort liegt.

export function isOpaqueScriptError(message, source, lineno, colno, error) {
  const msg = String(message || '').trim();
  if (!/^script error\.?$/i.test(msg)) return false;
  return !source && !Number(lineno) && !Number(colno) && !error;
}

/**
 * @param {{ message?: unknown, source?: string, lineno?: number, colno?: number, error?: Error|null,
 *           assetPrefix: string, dev?: boolean }} info
 *   assetPrefix: absolute URL-Praefix der eigenen Skripte, z. B. https://skm.steei.de/assets/
 */
export function isForeignScriptError({ message, source, lineno, colno, error, assetPrefix, dev = false }) {
  if (isOpaqueScriptError(message, source, lineno, colno, error)) return true;
  if (dev || !assetPrefix) return false; // Dev-Server liefert Module unter /src/, dort alles zeigen
  const fromOwnFile = typeof source === 'string' && source.startsWith(assetPrefix);
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const stackHasOwnFile = stack.includes(assetPrefix);
  return !fromOwnFile && !stackHasOwnFile;
}
