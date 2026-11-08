// Adresse der aktuellen Seite fuer Bugreports und Rueckmeldungen, ohne Zugriffstoken.
//
// Job-Links koennen ein Zugriffstoken tragen (?token=... bzw. im Fragment). Das Token gibt Lesezugriff
// auf den Job, es gehoert nicht in einen Bugreport, der auf dem Server landet und von anderen
// gelesen wird. Entfernt werden Query-Parameter, deren Name "token" enthaelt, und ein Fragment, das
// "token" enthaelt (dann das ganze Fragment). Alles andere bleibt, damit der Bugreport die Seite zeigt.
export function reportUrl(href = (typeof window !== 'undefined' ? window.location.href : '')) {
  const raw = String(href || '');
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Keine gueltige URL: lieber nichts als ein Token mitschicken.
    return /token/i.test(raw) ? '' : raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/token/i.test(key)) url.searchParams.delete(key);
  }
  if (/token/i.test(url.hash)) url.hash = '';
  return url.toString();
}
