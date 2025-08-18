// IndexedDB-Client für Zahlungen eines Wallets
// Alle Funktionen werfen i18n-Fehler unter error.cache.*

const DB_NAME = 'stm_wallet_cache';
const DB_VERSION = 2; // 2 = Upgrade auslösen, damit META sicher angelegt wird
const STORE = 'payments';
const META = 'meta';

// Hilfsfunktionen: Memo extrahieren & Datensatz normalisieren
function extractMemo(rec) {
  // Horizon (join=transactions) liefert das Memo unter rec.transaction?.memo
  const m = rec?.memo ?? rec?.transaction?.memo ?? '';
  return typeof m === 'string' ? m : String(m ?? '');
}

function normalizePayment(accountId, rec) {
  return {
    ...rec,
    accountId,
    // created_at absichern (sollte vorhanden sein, falls nicht leerer String → sortiert ans Ende)
    created_at: rec?.created_at ?? rec?.transaction?.created_at ?? '',
    // ⚠️ WICHTIG: Root-Feld 'memo' MUSS existieren, sonst scheitert der Compound-Index ['accountId','memo']
    memo: extractMemo(rec),
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'paging_token' });
        // Compound-Index: [accountId, created_at] für schnelle Range-Queries je Wallet
        os.createIndex('by_account_created', ['accountId','created_at'], { unique: false });
        os.createIndex('by_account_memo', ['accountId','memo'], { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('error.cache.openFailed'));
  });
}

/** Schreibt/aktualisiert eine Seite Zahlungen. */
/** Schreibt/aktualisiert eine Seite Zahlungen. */
export async function bulkUpsertPayments(accountId, items = []) {
  let _err;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([STORE], 'readwrite');
        const store = tx.objectStore(STORE);

        for (const it of items) {
          // ⚙️ Normalisieren, damit Index-KeyPaths immer erfüllt sind
          const safe = normalizePayment(accountId, it);
          store.put(safe); // keyPath = 'paging_token' vorhanden auf Horizon-Records
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('AbortError'));
      } catch (e) {
        reject(e);
      }
    });
    db.close?.();
  } catch (e) {
    _err = e;
    // Diagnostik an den Error-Key anhängen, damit UI (t()) was Sinnvolles anzeigen kann
    const detail = (e && (e.name || e.message)) ? (e.name + ':' + e.message) : 'unknown';
    throw new Error('error.cache.writeFailed:' + detail);
  }
}

/** Liest Zahlungen nach Zeitraum + optionalem Memo-Substring. */
export async function getPaymentsByRangeAndMemo(accountId, {fromISO, toISO, memo}) {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE], 'readonly');
    const idx = tx.objectStore(STORE).index('by_account_created');
    const lower = [accountId, fromISO ?? ''];
    const upper = [accountId, toISO ?? '\uffff'];
    const req = idx.openCursor(IDBKeyRange.bound(lower, upper, false, false), 'prev');
    const out = [];
    await new Promise((res, rej) => {
      req.onerror = () => rej(new Error('error.cache.readFailed'));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return res();
        const v = cur.value;
        if (!memo || (v.memo && v.memo.includes(memo))) out.push(v);
        cur.continue();
      };
    });
    db.close?.();
    return out;
  } catch { throw new Error('error.cache.readFailed'); }
}

/**
 * Speichert den Horizon-Paging-Cursor *pro Account* als String.
 * Validiert Eingaben und wartet sicher auf Transaktionsabschluss.
 */
export async function setCursor(accountId, cursor) {
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('cache.cursor.setFailed:invalidAccountId');
  }
  if (typeof cursor !== 'string' || !cursor.trim()) {
    throw new Error('cache.cursor.setFailed:invalidCursor');
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([META], 'readwrite');
      const store = tx.objectStore(META);
      const key = `cursor:${accountId}`;
      const req = store.put(cursor, key);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('cache.cursor.setFailed:txAborted'));
    } catch (err) { reject(err); }
  });
  db.close?.();
}

// utils/db/indexedDbClient.js (oder .ts)
// Liefert den zuletzt gespeicherten paging_token als String oder null
export async function getCursor(accountId) {
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('cache.cursor.getFailed:invalidAccountId');
  }
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([META], 'readonly');
      const store = tx.objectStore(META);
      const key = `cursor:${accountId}`;
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('cache.cursor.getFailed:txAborted'));
    } catch (err) { reject(err); }
  });
  db.close?.();

  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.cursor === 'string') return value.cursor;

  throw new Error('cache.cursor.getFailed:badType');
}

export async function clearCursor(accountId) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([META], 'readwrite');
      const store = tx.objectStore(META);
      const key = `cursor:${accountId}`;
      const req = store.delete(key);

      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('cache.cursor.clearFailed:txAborted'));
    } catch (err) {
      reject(err);
    }
  });
  db.close?.();
}


