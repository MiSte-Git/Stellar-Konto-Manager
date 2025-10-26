
/*
  Harmonisierte Backend-Startdatei
  Diese Datei dient nur noch als dünner Wrapper und startet den zentralen Root-Server.
  Damit vermeiden wir doppelte Implementierungen und stellen sicher, dass /api/bugreport etc. verfügbar sind.
*/

try {
  // Starte den zentralen Express-Server (root/server.js)
  require('../server.js');
} catch (e) {
  console.error('backend/server.js: Start des Root-Servers fehlgeschlagen:', e?.message || e);
  process.exit(1);
}
