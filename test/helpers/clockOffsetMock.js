// Nur fuer Tests: verschiebt Date.now() im gestarteten server.js um den Wert (Sekunden) aus der
// Datei SKM_TEST_CLOCK_OFFSET_FILE, damit z. B. eine Challenge ablaufen kann, ohne 60 s zu
// warten. Wird per `node --require` geladen, nie im Produktionscode. Die Datei wird bei jedem
// Aufruf gelesen; fehlt sie oder ist sie leer, gilt Offset 0.
const fs = require('fs');

const file = process.env.SKM_TEST_CLOCK_OFFSET_FILE;
if (!file) throw new Error('clockOffsetMock: SKM_TEST_CLOCK_OFFSET_FILE fehlt');

const realNow = Date.now.bind(Date);
Date.now = function now() {
  let offset = 0;
  try { offset = Number(fs.readFileSync(file, 'utf8')) || 0; } catch { offset = 0; }
  return realNow() + offset * 1000;
};
