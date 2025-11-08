// frontend/src/utils/log/errorLog.js
// Centralized error logging (localStorage + optional backend relay)

const STORAGE_KEY = 'stm.error.log';

/**
 * Append an error entry to localStorage log
 * @param {{ type: string, message: string, status?: number, stack?: string, extras?: any }} entry
 */
export function logError(entry) {
  try {
    const now = new Date().toISOString();
    const item = {
      ts: now,
      type: String(entry.type || 'unknown'),
      message: String(entry.message || ''),
      status: entry.status ?? undefined,
      stack: entry.stack ? String(entry.stack) : undefined,
      extras: entry.extras ?? undefined,
    };
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    arr.unshift(item);
    // cap at ~200 entries
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, 200)));
  } catch {
    // noop
  }
}

/**
 * Try to send error entry to backend if VITE_BACKEND_URL is set and endpoint exists
 * @param {object} entry
 */
export async function relayError(entry) {
  try {
    const base = import.meta.env.VITE_BACKEND_URL || '';
    if (!base) return;
    const url = base.replace(/\/$/, '') + '/log-client-error';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      credentials: 'omit'
    });
    if (!res.ok) {
      // store failed relay attempt
      logError({ type: 'relayFailed', message: 'Backend log rejected', status: res.status });
    }
  } catch (e) {
    logError({ type: 'relayFailed', message: e?.message || String(e) });
  }
}

/**
 * Convenience: log and optionally relay
 */
export function logAndRelay(entry, { relay = true } = {}) {
  logError(entry);
  if (relay) void relayError(entry);
}
