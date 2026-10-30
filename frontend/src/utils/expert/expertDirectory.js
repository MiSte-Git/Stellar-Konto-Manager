// StellarExpert-Directory fuer viele Konten (Groupfund-Absender), ueber trade/assets/expert.
//
// Bewusst nur auf Knopfdruck und in Stapeln: Node begrenzt alle API-Aufrufe zusammen auf
// 100 je 15 Minuten und IP, PHP hat weder Limit noch Cache, stellar.expert nennt keine
// Grenzen. Ein automatischer Abruf fuer rund 100 Absender wuerde das Limit allein
// ausschoepfen und danach auch alle anderen API-Aufrufe sperren.
//
// Beide Backends melden ein Limit von stellar.expert als HTTP 200 mit status "unavailable",
// ohne Ursache. Eine Folge solcher Antworten gilt deshalb als Limit; eine Stoerung dort
// laesst sich davon nicht unterscheiden. Nicht erreichbar heisst: unser Backend antwortet nicht.
import { isTestNetwork } from '../../config/networks.js';
import { apiUrl } from '../apiBase.js';

export const DIRECTORY_CONCURRENCY = 3;
export const DIRECTORY_BATCH_SIZE = 40;
// So viele Ausfaelle in Folge beenden den Stapel.
const MAX_CONSECUTIVE_FAILURES = 3;

const sessionCache = new Map();
const cacheKey = (network, account) => `${network}:${account}`;

/** Bekannter Eintrag aus diesem Browser-Tab, sonst undefined. */
export function getCachedDirectoryEntry(network, account) {
  return sessionCache.get(cacheKey(network, account));
}

/** Fuer Tests. */
export function clearDirectoryCache() {
  sessionCache.clear();
}

// Fehler werden nicht gecacht, damit ein spaeterer Versuch die Luecke schliesst.
async function fetchEntry(account, network, signal) {
  const params = new URLSearchParams({ issuer: account, network });
  try {
    const response = await fetch(`${apiUrl('trade/assets/expert')}?${params.toString()}`, { signal });
    if (response.status === 429) return { status: 'rateLimited' };
    const entry = await response.json().catch(() => null);
    if (!response.ok || !entry) return { status: 'failed' };
    return {
      status: entry.status || 'unavailable',
      name: entry.name || '',
      domain: entry.domain || '',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    };
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Fragt noch unbekannte Konten ab, hoechstens DIRECTORY_BATCH_SIZE je Aufruf.
 * @returns {Promise<{ checked: number, remaining: number, stopped: ''|'rateLimited'|'unavailable'|'aborted' }>}
 */
export async function loadDirectoryBatch({ accounts, network, signal, onEntry }) {
  // Das Directory fuehrt nur das Public-Netz.
  if (isTestNetwork(network)) return { checked: 0, remaining: 0, stopped: '' };
  const open = [...new Set(accounts)].filter((account) => !sessionCache.has(cacheKey(network, account)));
  const queue = open.slice(0, DIRECTORY_BATCH_SIZE);
  let checked = 0;
  let failures = 0;
  let stopped = '';

  const worker = async () => {
    while (queue.length && !stopped) {
      if (signal?.aborted) { stopped = 'aborted'; return; }
      const account = queue.shift();
      const entry = await fetchEntry(account, network, signal);
      if (signal?.aborted) { stopped = 'aborted'; return; }
      if (entry.status === 'rateLimited') { stopped = 'rateLimited'; return; }
      if (entry.status === 'failed' || entry.status === 'unavailable') {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) stopped = entry.status === 'failed' ? 'unavailable' : 'rateLimited';
        continue;
      }
      failures = 0;
      checked += 1;
      sessionCache.set(cacheKey(network, account), entry);
      onEntry?.(account, entry);
    }
  };
  await Promise.all(Array.from({ length: DIRECTORY_CONCURRENCY }, worker));
  return { checked, remaining: open.length - checked, stopped };
}

/** Das Directory fuehrt das Konto als Boerse. */
export function isExchangeEntry(entry) {
  return (entry?.tags || []).includes('exchange');
}
