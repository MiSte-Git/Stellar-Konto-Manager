// Ausgeblendete Multisig-Jobs je Netz und Konto, nur in diesem Browser (localStorage).
// Ausblenden wirkt nur fuer mich; andere Signer und der Job selbst bleiben unberuehrt.
// Ein reiner Komfort: Ist der Speicher nicht nutzbar, ist eben nichts ausgeblendet.
const PREFIX = 'skm_multisig_hidden_v1:';
const MAX_IDS = 500;

function storageKey(network, accountId) {
  return `${PREFIX}${network || ''}:${accountId || ''}`;
}

export function readHiddenJobIds(network, accountId) {
  try {
    const raw = window.localStorage.getItem(storageKey(network, accountId));
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenJobIds(network, accountId, ids) {
  try {
    window.localStorage.setItem(storageKey(network, accountId), JSON.stringify([...ids].slice(-MAX_IDS)));
  } catch { /* nur Komfort */ }
}
