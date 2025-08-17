// Formatiert ISO-Strings lokal (System-Zeitzone) und leserlich.
// Beispiel: "17.08.2025, 19:05:12"
export function formatLocalDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(d);
}

// NEU: "mm:ss" Laufzeitanzeige (ohne Stunden)
export function formatElapsedMmSs(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// NEU: Minuten nur als ganze Zahl (für „finalize“)
export function elapsedMinutesRounded(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.ceil(ms / 60000); // 65:12 => 66 Minuten (oder nimm Math.floor, wenn dir „65“ lieber ist)
}
