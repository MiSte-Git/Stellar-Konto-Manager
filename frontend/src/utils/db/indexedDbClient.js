// IndexedDB-Client für Zahlungen eines Wallets
// Alle Funktionen werfen i18n-Fehler unter error.cache.*

const DB_NAME = 'stm_wallet_cache';
const DB_VERSION = 4; // 4 = Upgrade für memo_norm + Index by_account_memo_created
const STORE = 'payments';
const META = 'meta';

function asStr(v){ if(v==null) return ''; return typeof v==='string' ? v : String(v); }
function extractMemo(rec){ return asStr(rec?.memo ?? rec?.transaction?.memo ?? ''); }

// Normalisiert Memos für Index-Suche (Trim, Whitespace bündeln, Großschreibung, ZWNB entfernen)
function normMemo(s){
  return String(s||'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
}

// --- At-rest encryption for memo fields (F6) -------------------------------
// Memos are free text and may contain names, invoice numbers etc. They are
// encrypted (AES-GCM) before being written to IndexedDB. The key itself lives
// in the same origin's IndexedDB (META store), so this does not protect
// against a same-origin XSS attacker who could call these same functions —
// it protects against casual/non-JS inspection of the raw IndexedDB storage
// (devtools "Application" tab, browser profile/disk access, extensions that
// read storage without executing page JS).
const ENC_PREFIX = 'enc1:';
const ENC_KEY_META_KEY = 'encKey:v1';
let _encKeyPromise = null;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getEncryptionKey() {
  if (_encKeyPromise) return _encKeyPromise;
  _encKeyPromise = (async () => {
    const db = await openDb();
    try {
      const existing = await new Promise((resolve, reject) => {
        const tx = db.transaction([META], 'readonly');
        const req = tx.objectStore(META).get(ENC_KEY_META_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (existing) {
        return await crypto.subtle.importKey('raw', base64ToBytes(existing), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      }
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      await new Promise((resolve, reject) => {
        const tx = db.transaction([META], 'readwrite');
        tx.objectStore(META).put(bytesToBase64(exported), ENC_KEY_META_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return key;
    } finally {
      db.close?.();
    }
  })();
  return _encKeyPromise;
}

/** Encrypts a text field for storage. Empty values stay empty (no crypto overhead). */
async function encryptField(plaintext) {
  const s = String(plaintext ?? '');
  if (!s) return '';
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(s));
    return ENC_PREFIX + bytesToBase64(iv) + ':' + bytesToBase64(new Uint8Array(ct));
  } catch {
    // crypto.subtle unavailable (very old browser) → fail open rather than losing the memo.
    return s;
  }
}

/** Decrypts a stored text field. Plaintext/legacy values (pre-encryption cache entries) pass through unchanged. */
async function decryptField(stored) {
  const s = String(stored ?? '');
  if (!s || !s.startsWith(ENC_PREFIX)) return s;
  try {
    const [ivB64, ctB64] = s.slice(ENC_PREFIX.length).split(':');
    const key = await getEncryptionKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB64) }, key, base64ToBytes(ctB64));
    return new TextDecoder().decode(plain);
  } catch {
    return ''; // corrupted/undecryptable — fail safe, do not crash the UI
  }
}

/** Whitelist → nur klonbare Felder speichern. Memo-Felder werden verschlüsselt (F6). */
async function toSafePayment(accountId, rec){
  const paging_token = asStr(rec?.paging_token);
  if (!paging_token) return null; // ohne keyPath nicht speicherbar
  const rawMemo = extractMemo(rec);
  const rawTransactionMemo = asStr(rec?.transaction?.memo ?? '');
  const [encMemo, encTransactionMemo, encMemoNorm] = await Promise.all([
    encryptField(rawMemo),
    encryptField(rawTransactionMemo),
    encryptField(normMemo(rawMemo)),
  ]);
  return {
    paging_token,
    id: asStr(rec?.id),
    type: asStr(rec?.type),
    from: asStr(rec?.from),
    to: asStr(rec?.to),
    account: asStr(rec?.account),            // create_account → Zielkonto
    source_account: asStr(rec?.source_account),
    amount: asStr(rec?.amount),
    starting_balance: asStr(rec?.starting_balance), // create_account → Betrag
    into: asStr(rec?.into),                  // account_merge → Ziel (falls du es später brauchst)
    asset_type: asStr(rec?.asset_type),
    asset_code: asStr(rec?.asset_code),
    asset_issuer: asStr(rec?.asset_issuer),
    created_at: asStr(rec?.created_at || rec?.transaction?.created_at),
    transaction_hash: asStr(rec?.transaction_hash || rec?.transaction?.hash),
    // Memo-Felder: verschlüsselt gespeichert. memo_norm diente einem (ungenutzten)
    // Such-Index, der durch die Verschlüsselung ohnehin keine Klartext-Exakttreffer
    // mehr liefern kann - bleibt aus Schema-Kompatibilität bestehen, aber ebenfalls verschlüsselt.
    memo: encMemo,
    memo_type: asStr(rec?.memo_type ?? rec?.transaction?.memo_type ?? ''),
    transaction_memo: encTransactionMemo,
    memo_norm: encMemoNorm,
    accountId: asStr(accountId),
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const tx = ev?.target?.transaction;
      // Store anlegen oder öffnen
      let os;
      if (db.objectStoreNames.contains(STORE)) {
        os = tx.objectStore(STORE);
      } else {
        os = db.createObjectStore(STORE, { keyPath: 'paging_token' });
      }
      // Indexe sicherstellen
      if (!os.indexNames.contains('by_account_created')) {
        os.createIndex('by_account_created', ['accountId','created_at'], { unique: false });
      }
      if (!os.indexNames.contains('by_account_memo')) {
        os.createIndex('by_account_memo', ['accountId','memo'], { unique: false });
      }
      // Neu: schneller Memo+Zeit Index
      if (!os.indexNames.contains('by_account_memo_created')) {
        os.createIndex('by_account_memo_created', ['accountId','memo_norm','created_at'], { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('error.cache.openFailed'));
  });
}

/** Schreibt/aktualisiert eine Seite Zahlungen. */
export async function bulkUpsertPayments(accountId, items = []) {
  try {
    const db = await openDb();
    // Encrypt/prepare all payloads BEFORE opening the write transaction: IndexedDB
    // transactions auto-commit if control returns to the event loop (i.e. on await)
    // without a pending request, so no async work may happen inside the tx below.
    const prepared = [];
    for (const raw of items) {
      const safe = await toSafePayment(accountId, raw);
      if (!safe) continue;
      // Roundtrip erzwingt strukturelle Klonbarkeit
      prepared.push(JSON.parse(JSON.stringify(safe)));
    }
    await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([STORE], 'readwrite');
        const store = tx.objectStore(STORE);

        for (const plain of prepared) {
          store.put(plain); // keyPath = 'paging_token'
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort  = () => reject(tx.error || new Error('AbortError'));
      } catch (e) { reject(e); }
    });
    db.close?.();
  } catch (e) {
    const detail = (e?.name || e?.message) ? `${e.name}:${e.message}` : 'unknown';
    throw new Error('error.cache.writeFailed:' + detail);
  }
}


/** Liest Zahlungen nach Zeitraum + optionalem Memo-Substring. */
export async function getPaymentsByRangeAndMemo(accountId, { fromISO, toISO }) {
  const db = await openDb();
  const out = [];

  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE], 'readonly');                 // STORE = 'payments'
      const idx = tx.objectStore(STORE).index('by_account_created');  // ['accountId','created_at']

      const lower = [accountId, fromISO || ''];
      const upper = [accountId, toISO   || '\uffff'];
      const range = IDBKeyRange.bound(lower, upper);

      const req = idx.openCursor(range, 'next'); // älteste→neueste im Fenster

      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value;

        out.push(v);

        cur.continue();
      };

      req.onerror  = () => reject(req.error);
      tx.onerror   = () => reject(tx.error);
      tx.onabort   = () => reject(tx.error || new Error('error.cache.readFailed:txAborted'));
    } catch (e) {
      reject(e);
    }
  });

  db.close?.();
  return Promise.all(out.map(async (v) => ({
    ...v,
    memo: await decryptField(v.memo),
    transaction_memo: await decryptField(v.transaction_memo),
  })));
}

 /**
 * Backfill für memo_norm im Zeitraum. Nützlich nach Upgrade, damit der neue Index sofort greift.
 * UNGENUTZT und seit F6 (Memo-Verschlüsselung) inkompatibel: memo/memo_norm sind jetzt
 * verschlüsselt, `normMemo()` auf den Chiffretext anzuwenden ergäbe sinnlose Werte.
 * Vor einer Reaktivierung müsste diese Funktion die Felder erst entschlüsseln.
 * @param {object} p
 * @param {string} p.accountId
 * @param {string} [p.fromISO]
 * @param {string} [p.toISO]
 * @param {function} [p.onProgress] - optionales Progress-Callback
 */
export async function backfillMemoNorm({ accountId, fromISO, toISO, onProgress }) {
  const db = await openDb();
  let scanned = 0, updated = 0;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readwrite');
      const idx = tx.objectStore(STORE).index('by_account_created');
      const range = IDBKeyRange.bound([accountId, fromISO || ''], [accountId, toISO || '\uffff']);
      const req = idx.openCursor(range, 'next');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value; scanned++;
        const want = normMemo(v.memo || v.transaction_memo || '');
        if (v.memo_norm !== want) {
          v.memo_norm = want;
          cur.update(v);
          updated++;
        }
        if (scanned % 500 === 0) onProgress?.({ phase:'memoNorm', scanned, updated });
        cur.continue();
      };
      req.onerror = () => reject(new Error('error.cache.memoNormBackfillFailed'));
      tx.oncomplete = () => { onProgress?.({ phase:'memoNorm', scanned, updated }); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('error.cache.memoNormBackfillFailed:txAborted'));
    });
  } finally {
    db.close?.();
  }
  return { scanned, updated };
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
export async function getOldestCreatedAt(accountId) {
  const db = await openDb();
  const val = await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE], 'readonly');          // STORE = 'payments'
      const idx = tx.objectStore(STORE).index('by_account_created'); // ['accountId','created_at']
      const range = IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']);
      const req = idx.openCursor(range, 'next'); // älteste zuerst
      req.onsuccess = () => {
        const cur = req.result;
        resolve(cur ? (cur.value?.created_at || null) : null);
      };
      req.onerror  = () => reject(req.error);
      tx.onerror   = () => reject(tx.error);
      tx.onabort   = () => reject(tx.error || new Error('cache.coverage.oldestFailed:txAborted'));
    } catch (e) { reject(e); }
  });
  db.close?.();
  return val;
}
export async function getNewestCreatedAt(accountId) {
  const db = await openDb();
  const newest = await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE], 'readonly');
      const idx = tx.objectStore(STORE).index('by_account_created'); // ['accountId','created_at']
      const range = IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']);
      // 'prev' = neueste zuerst
      const req = idx.openCursor(range, 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        resolve(cur ? (cur.value?.created_at || null) : null);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('cache.coverage.newestFailed:txAborted'));
    } catch (e) { reject(e); }
  });
  db.close?.();
  return newest;
}
 /**
  * Lädt fehlende Memos im Zeitfenster nach.
  * Strategie: Falls transaction_hash fehlt → Payment-Op laden → tx_hash ermitteln → Transaction laden → memo/memo_type speichern.
  * Wirft i18n-Key bei fatalen DB-Fehlern. UI fängt via t() ab.
  */
 export async function rehydrateEmptyMemos({ server, accountId, fromISO, toISO, onProgress }) {
  // Phase 1: Kandidaten im Fenster einsammeln (rein lokal, keine async-Awaits im Cursor)
  const db = await openDb();
  let scanned = 0, candidates = 0;
  const need = []; // { paging_token, id, transaction_hash }
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readonly');
      const idx = tx.objectStore(STORE).index('by_account_created');
      const lower = [accountId, fromISO || ''], upper = [accountId, toISO || '\uffff'];
      const req = idx.openCursor(IDBKeyRange.bound(lower, upper), 'next');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value; scanned++;
        const hasMemo = !!(v.memo && String(v.memo).trim());
        if (!hasMemo) {
          candidates++;
          need.push({ paging_token: v.paging_token, id: v.id, transaction_hash: v.transaction_hash });
        }
        if (scanned % 500 === 0) onProgress?.({ phase:'rehydrate', progress: Math.min(0.8, scanned/5000), scanned, candidates });
        cur.continue();
      };
      req.onerror = () => reject(new Error('error.cache.rehydrateFailed'));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('error.cache.rehydrateFailed:txAborted'));
    });
  } finally {
    db.close?.();
  }

  // Phase 2: Netzwerkabrufe + Updates in kleinen Batches
  let updated = 0;
  for (let i = 0; i < need.length; i++) {
    const row = need[i];
    try {
      let txHash = row.transaction_hash;
      if (!txHash && row.id) {
        try {
          const op = await server.payments().payment(row.id).call();
          txHash = op?.transaction_hash || txHash;
        } catch {void 0;}
      }
      if (txHash) {
        try {
          const tr = await server.transactions().transaction(txHash).call();
          const memo = (tr?.memo || '').toString();
          const mt   = (tr?.memo_type || '').toString();
          if (memo) {
            // Verschlüsseln VOR dem Öffnen der Schreib-TX (kein await im TX-Callback erlaubt).
            const encMemo = await encryptField(memo);
            const encMemoNorm = await encryptField(normMemo(memo));
            // getrennte Schreib-TX, kein Cursor mehr offen
            const wdb = await openDb();
            await new Promise((resolve, reject) => {
              const tx = wdb.transaction([STORE], 'readwrite');
              const store = tx.objectStore(STORE);
              const getReq = store.get(row.paging_token);
              getReq.onsuccess = () => {
                const v = getReq.result;
                if (v) {
                  v.memo = encMemo; v.memo_type = mt; v.memo_norm = encMemoNorm;
                  store.put(v);
                }
              };
              getReq.onerror = () => reject(new Error('error.cache.rehydrateWriteFailed'));
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error || new Error('error.cache.rehydrateWriteFailed:txAborted'));
            });
            wdb.close?.();
            updated++;
          }
        } catch {void 0;}
      }
    } catch {
      // intentionally ignored
    }
    if (i % 50 === 0) onProgress?.({ phase:'rehydrate', progress: 0.8 + Math.min(0.19, i / Math.max(1, need.length)), scanned, candidates, updated });
  }
  onProgress?.({ phase:'rehydrate', progress: 1, scanned, candidates, updated });
  return { scanned, candidates, updated };
}

// UNGENUTZT und seit F6 (Memo-Verschlüsselung) funktional eingeschränkt: `memo` wird
// jetzt verschlüsselt gespeichert, wodurch der native `by_account_memo`-Index nur noch
// Chiffretexte enthält. Ein exakter Treffer auf einen Klartext-`memoQuery` ist über den
// IndexedDB-Index damit nicht mehr möglich (die Filterung passiert auf Engine-Ebene, bevor
// app-seitig entschlüsselt werden könnte). Bei Reaktivierung: stattdessen über
// `by_account_created` scannen, entschlüsseln und den Vergleich in JS durchführen.
export async function iterateByAccountMemoRange({ accountId, memoQuery, fromISO, toISO, onRow }) {
  const db = await openDb();
  const memoRaw = String(memoQuery || '').trim();
  const rows = [];
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE], 'readonly');
      const os = tx.objectStore(STORE);
      // Case-sensitives Matching: immer den 2er-Index ['accountId','memo'] verwenden
      const idx = os.index('by_account_memo');

      const range = IDBKeyRange.only([accountId, memoRaw]);

      const req = idx.openCursor(range, 'next');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value;
        // Zeitfenster lokal filtern
        if ((fromISO && v.created_at < fromISO) || (toISO && v.created_at > toISO)) {
          return cur.continue();
        }
        rows.push(v);
        cur.continue();
      };
      req.onerror = () => reject(new Error('error.cache.indexIterFailed'));
    } catch (e) { reject(e); }
  });
  db.close?.();
  // Entschlüsseln nach Transaktionsende (kein await innerhalb einer offenen IDB-TX möglich).
  for (const v of rows) {
    onRow?.({ ...v, memo: await decryptField(v.memo), transaction_memo: await decryptField(v.transaction_memo) });
  }
}

/**
 * Iteriert lokale Zahlungen im Zeitfenster über Index 'by_account_created'.
 * Nutzt keine Memo-Indizes, damit Cache/No-Cache identisch filtern.
 */
export async function iterateByAccountCreatedRange({ accountId, fromISO, toISO, onRow }) {
  const db = await openDb();
  const rows = [];
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE], 'readonly');
      const os = tx.objectStore(STORE);
      const idx = os.index('by_account_created');
      // toISO ist exklusive Obergrenze
      const lower = [accountId, fromISO || ''];
      const upper = [accountId, toISO   || '\uffff'];
      const req = idx.openCursor(IDBKeyRange.bound(lower, upper), 'prev'); // neu->alt

      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        rows.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(new Error('error.cache.indexIterFailed'));
    } catch (e) { reject(e); }
  });
  db.close?.();
  // Entschluesseln nach Transaktionsende (kein await innerhalb einer offenen IDB-TX moeglich);
  // Reihenfolge bleibt identisch zur bisherigen Cursor-Reihenfolge (neu->alt).
  for (const v of rows) {
    onRow?.({ ...v, memo: await decryptField(v.memo), transaction_memo: await decryptField(v.transaction_memo) });
  }
}

/**
 * Löscht den kompletten lokalen Zahlungs-Cache (alle Konten) inkl. gespeicherter
 * Paging-Cursor. Für eine sichtbare "Cache leeren"-Funktion in den Einstellungen (F6).
 */
export async function clearAllCachedPayments() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE, META], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('error.cache.clearFailed:txAborted'));
    } catch (e) { reject(e); }
  });
  db.close?.();
  // The encryption key just got wiped from META along with everything else;
  // drop the in-memory cache so the next write generates+persists a fresh one.
  _encKeyPromise = null;
}
