// Einstellungen der Groupfund-Ansicht je Konto und Netzwerk (localStorage, keine Secrets).
import { DEFAULT_BUFFER_XLM } from './stellar/groupfundRounds.js';

const PREFIX = 'skm.groupfund.v1';
const storageKey = (network, accountId) => `${PREFIX}:${network}:${accountId}`;

export const DEFAULT_PREFS = Object.freeze({ mode: 'muxed', memo: '', bufferXlm: DEFAULT_BUFFER_XLM, dismissed: [], manual: [] });

const isOpId = (value) => typeof value === 'string' && /^\d+$/.test(value);

// Grenze mit den Angaben fuer die Anzeige, auch wenn sie nicht mehr erkannt wird.
function sanitizeBoundaries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => isOpId(b?.opId))
    .map((b) => ({
      opId: b.opId,
      txHash: String(b.txHash || ''),
      createdAt: String(b.createdAt || ''),
      to: String(b.to || ''),
      outflow: String(b.outflow || ''),
      balanceAfter: String(b.balanceAfter || ''),
      hasIncoming: !!b.hasIncoming,
    }));
}

function sanitize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: value.mode === 'memo' ? 'memo' : 'muxed',
    memo: typeof value.memo === 'string' ? value.memo : '',
    bufferXlm: typeof value.bufferXlm === 'string' && value.bufferXlm ? value.bufferXlm : DEFAULT_BUFFER_XLM,
    dismissed: sanitizeBoundaries(value.dismissed),
    manual: sanitizeBoundaries(value.manual),
  };
}

export function loadGroupfundPrefs(network, accountId) {
  try {
    const raw = window.localStorage.getItem(storageKey(network, accountId));
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const listeners = new Set();

/** Meldet Aenderungen an alle Ansichten desselben Kontos, auch ohne verfuegbaren Speicher. */
export function subscribeGroupfundPrefs(network, accountId, listener) {
  const key = storageKey(network, accountId);
  const entry = { key, listener };
  listeners.add(entry);
  return () => listeners.delete(entry);
}

export function saveGroupfundPrefs(network, accountId, prefs) {
  const key = storageKey(network, accountId);
  try {
    window.localStorage.setItem(key, JSON.stringify(sanitize(prefs)));
  } catch { /* Speicher nicht verfuegbar: Einstellungen gelten nur bis zum Neuladen */ }
  // Rohwert: Ein gerade geleertes Eingabefeld darf nicht auf den Standard zurueckspringen.
  listeners.forEach((entry) => { if (entry.key === key) entry.listener(prefs); });
}
