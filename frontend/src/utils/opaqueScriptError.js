// Fehler aus fremden Skripten (z. B. von Browser-Erweiterungen oder dem Werbeblocker in Brave
// auf iOS eingeschleust) meldet der Browser aus Datenschutzgruenden nur als "Script error."
// ohne Quelle, Zeile und Error-Objekt. Daraus laesst sich nichts ableiten, und es ist kein
// Fehler von SKM, deshalb nicht als Fehlermeldung in der App anzeigen.
export function isOpaqueScriptError(message, source, lineno, colno, error) {
  const msg = String(message || '').trim();
  if (!/^script error\.?$/i.test(msg)) return false;
  return !source && !Number(lineno) && !Number(colno) && !error;
}
