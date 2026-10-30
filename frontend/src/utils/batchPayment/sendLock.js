// Exklusiver Sendevorgang pro Netz ueber alle Tabs dieses Browsers.
//
// 1. Web Locks (navigator.locks), wo vorhanden (sichere Kontexte: https, localhost).
// 2. Sonst ein localStorage-Lock mit Besitzer-ID und Zeitstempel (z.B. http ueber LAN-IP).
//    Er wird waehrend des Laufs regelmaessig erneuert und gilt nach LOCK_TTL_MS ohne
//    Erneuerung als verwaist (abgestuerzter Tab). Nach dem Setzen wird kurz gewartet und
//    zurueckgelesen, damit bei gleichzeitigem Setzen nur einer gewinnt.
//
// Ist der Lock belegt, wird onWaiting() aufgerufen und gewartet, bis er frei wird oder
// signal abbricht (dann wirft die Funktion einen Fehler mit name 'AbortError').
//
// fn bekommt { touch, isHeld }: touch() erneuert den Lock (vor jeder Zahlung aufrufen),
// isHeld() sagt, ob er noch uns gehoert. Im localStorage-Fallback kann er verloren gehen,
// wenn der Tab gedrosselt oder eingefroren war und ein anderer Tab ihn uebernommen hat;
// der Lauf muss dann stoppen. Bei Web Locks gehoert er bis zum Ende sicher uns.

export const LOCK_TTL_MS = 3 * 60 * 1000;
const HEARTBEAT_MS = 10 * 1000;
const STORAGE_LOCK_PREFIX = 'skm_batch_send_lock_v1:';

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(abortError()); }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function readLock(key) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || 'null');
    return v && typeof v.owner === 'string' && Number.isFinite(Number(v.at)) ? { owner: v.owner, at: Number(v.at) } : null;
  } catch {
    return null;
  }
}

function writeLock(key, owner) {
  window.localStorage.setItem(key, JSON.stringify({ owner, at: Date.now() }));
}

async function withStorageLock(name, fn, { signal, onWaiting, settleMs = 100, pollMs = 500 } = {}) {
  const key = `${STORAGE_LOCK_PREFIX}${name}`;
  const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let notified = false;
  for (;;) {
    if (signal?.aborted) throw abortError();
    const cur = readLock(key);
    const free = !cur || cur.owner === owner || Date.now() - cur.at > LOCK_TTL_MS;
    if (free) {
      writeLock(key, owner);
      try {
        await sleep(settleMs, signal);
      } catch (e) {
        // Abbruch im Settle-Fenster: eigenen, eben geschriebenen Lock wieder entfernen.
        try { if (readLock(key)?.owner === owner) window.localStorage.removeItem(key); } catch { /* noop */ }
        throw e;
      }
      if (readLock(key)?.owner === owner) break;
    }
    if (!notified) { notified = true; onWaiting?.(); }
    await sleep(pollMs, signal);
  }
  const isHeld = () => readLock(key)?.owner === owner;
  const touch = () => {
    try { if (isHeld()) writeLock(key, owner); } catch { /* noop */ }
    return isHeld();
  };
  const heartbeat = setInterval(touch, HEARTBEAT_MS);
  try {
    return await fn({ touch, isHeld });
  } finally {
    clearInterval(heartbeat);
    try { if (readLock(key)?.owner === owner) window.localStorage.removeItem(key); } catch { /* noop */ }
  }
}

export async function withSendLock(network, fn, options = {}) {
  const name = `skm-batch-send-${network}`;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks || typeof locks.request !== 'function') return withStorageLock(name, fn, options);
  const { signal, onWaiting } = options;
  if (signal?.aborted) throw abortError();
  // Erst ohne Warten versuchen, damit die Oberflaeche "wartet" nur zeigt, wenn noetig.
  const held = { touch: () => true, isHeld: () => true };
  const first = await locks.request(name, { ifAvailable: true }, async (lock) => (lock ? { ran: true, value: await fn(held) } : { ran: false }));
  if (first.ran) return first.value;
  onWaiting?.();
  return locks.request(name, signal ? { signal } : {}, () => fn(held));
}
