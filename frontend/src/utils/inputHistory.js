export const RECENT_WALLETS_KEY = 'recentWallets';
export const PAYMENT_RECIPIENT_HISTORY_KEY = 'stm.hist.recipients';
export const PAYMENT_AMOUNT_HISTORY_KEY = 'stm.hist.amounts';
export const PAYMENT_MEMO_HISTORY_KEY = 'stm.hist.memos';
export const TEXT_INPUT_HISTORY_KEYS = [
  RECENT_WALLETS_KEY,
  PAYMENT_RECIPIENT_HISTORY_KEY,
  PAYMENT_AMOUNT_HISTORY_KEY,
  PAYMENT_MEMO_HISTORY_KEY,
];
export const INPUT_HISTORY_CHANGED_EVENT = 'skm:input-history-changed';

export function emitInputHistoryChanged(keys = TEXT_INPUT_HISTORY_KEYS) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(INPUT_HISTORY_CHANGED_EVENT, { detail: { keys } }));
}

export function readHistoryArray(key) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeHistoryArray(key, list, { silent = false } = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    /* noop */
  }
  if (!silent) emitInputHistoryChanged([key]);
}

export function removeHistoryValue(key, value) {
  const target = String(value || '').trim();
  if (!target) return [];
  const next = readHistoryArray(key).filter((entry) => String(entry || '').trim() !== target);
  writeHistoryArray(key, next);
  return next;
}

export function removeRecentWallet(publicKey) {
  const target = String(publicKey || '').trim();
  if (!target) return [];
  const next = readHistoryArray(RECENT_WALLETS_KEY).filter((entry) => {
    if (typeof entry === 'string') return entry.trim() !== target;
    const value = String(entry?.publicKey || entry?.address || entry?.value || '').trim();
    return value !== target;
  });
  writeHistoryArray(RECENT_WALLETS_KEY, next);
  return next;
}

export function clearHistoryKey(key) {
  writeHistoryArray(key, []);
}

export function clearAllTextInputHistories() {
  if (typeof window === 'undefined') return;
  for (const key of TEXT_INPUT_HISTORY_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }
  emitInputHistoryChanged(TEXT_INPUT_HISTORY_KEYS);
}
