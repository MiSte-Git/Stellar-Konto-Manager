// Stellar secret keys the user opts to "remember for this session" are kept in
// sessionStorage (cleared when the tab/browser closes), but AES-GCM-encrypted
// at rest (analogous to the memo-field encryption in db/indexedDbClient.js).
//
// The encryption key lives ONLY in memory (a module-level variable, never
// written to sessionStorage/localStorage/IndexedDB) and is regenerated on
// every page load. This is intentionally stricter than plain tab-close
// cleanup: a full page reload also invalidates every previously-stored
// secret, since the key needed to decrypt them no longer exists anywhere -
// decryptSecret() treats that failure the same as "no secret stored" (the
// user is simply prompted to re-enter it), never as an error.
//
// None of this protects against an XSS attacker running JS on this page -
// such an attacker can call these same exported functions and decrypt
// exactly like the app itself does. It protects against casual/non-JS
// inspection of the raw storage (devtools "Application" tab, browser
// profile/disk access, extensions reading storage without executing page
// JS) and, via the inactivity timeout below, shortens how long a forgotten,
// unattended tab keeps a usable secret around at all.

const MAP_PREFIX = 'stm.session.secrets.';
const LEGACY_PREFIX = 'stm.session.secret.';
const ENC_PREFIX = 'enc1:';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

let _encryptionKeyPromise = null;

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

function getEncryptionKey() {
  if (!_encryptionKeyPromise) {
    // extractable: false - this key is never meant to leave memory, not even via export.
    _encryptionKeyPromise = crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return _encryptionKeyPromise;
}

/** Encrypts a secret for storage. Empty values stay empty (no crypto overhead). */
async function encryptSecret(plaintext) {
  const s = String(plaintext ?? '');
  if (!s) return '';
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(s));
    return ENC_PREFIX + bytesToBase64(iv) + ':' + bytesToBase64(new Uint8Array(ct));
  } catch {
    // crypto.subtle unavailable (very old browser) → fail open rather than losing the secret.
    return s;
  }
}

/**
 * Decrypts a stored secret. Legacy/plaintext values (pre-encryption entries,
 * or entries from before a page reload wiped the in-memory key) pass through
 * as empty - the caller sees "no secret" and re-prompts, never a crash.
 */
async function decryptSecret(stored) {
  const s = String(stored ?? '');
  if (!s) return '';
  if (!s.startsWith(ENC_PREFIX)) return s; // legacy plaintext entry from before this change
  try {
    const [ivB64, ctB64] = s.slice(ENC_PREFIX.length).split(':');
    const key = await getEncryptionKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB64) }, key, base64ToBytes(ctB64));
    return new TextDecoder().decode(plain);
  } catch {
    return ''; // wrong/missing key (e.g. after a reload) or corrupted data → fail safe
  }
}

function readRawMap(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns the stored map of signerPublicKey -> encrypted secret, without decrypting anything. */
function readEncryptedMap(accountPublicKey) {
  if (!accountPublicKey) return {};
  const mapKey = `${MAP_PREFIX}${accountPublicKey}`;
  const fromMap = readRawMap(mapKey);
  if (fromMap) return fromMap;
  try {
    const legacy = sessionStorage.getItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    if (legacy) return { [accountPublicKey]: legacy };
  } catch { /* noop */ }
  return {};
}

export async function getSessionSecrets(accountPublicKey) {
  const encrypted = readEncryptedMap(accountPublicKey);
  const entries = await Promise.all(
    Object.entries(encrypted).map(async ([pk, enc]) => [pk, await decryptSecret(enc)])
  );
  return Object.fromEntries(entries.filter(([, sec]) => !!sec));
}

// Existence/count checks never need the plaintext, so these stay synchronous.
export function hasSessionSecrets(accountPublicKey) {
  return Object.keys(readEncryptedMap(accountPublicKey)).length > 0;
}

export function getSessionSecretCount(accountPublicKey) {
  return Object.keys(readEncryptedMap(accountPublicKey)).length;
}

export async function getSessionSecret(accountPublicKey, signerPublicKey) {
  if (!accountPublicKey || !signerPublicKey) return '';
  const encrypted = readEncryptedMap(accountPublicKey)[signerPublicKey];
  if (!encrypted) return '';
  return decryptSecret(encrypted);
}

export async function setSessionSecrets(accountPublicKey, secretsMap) {
  if (!accountPublicKey) return false;
  const entries = Object.entries(secretsMap || {}).filter(([pk, sec]) => pk && sec);
  const mapKey = `${MAP_PREFIX}${accountPublicKey}`;
  try {
    if (!entries.length) {
      sessionStorage.removeItem(mapKey);
      sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
      return false;
    }
    const encryptedEntries = await Promise.all(
      entries.map(async ([pk, sec]) => [pk, await encryptSecret(sec)])
    );
    sessionStorage.setItem(mapKey, JSON.stringify(Object.fromEntries(encryptedEntries)));
    sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    return true;
  } catch {
    return false;
  }
}

export async function rememberSessionSecrets(accountPublicKey, collected) {
  if (!accountPublicKey) return false;
  const next = {};
  for (const entry of (collected || [])) {
    const kp = entry?.keypair;
    const pk = kp?.publicKey?.();
    const sec = kp?.secret?.();
    if (pk && sec) next[pk] = sec;
  }
  if (!Object.keys(next).length) return false;
  const current = await getSessionSecrets(accountPublicKey);
  return setSessionSecrets(accountPublicKey, { ...current, ...next });
}

export function clearSessionSecrets(accountPublicKey) {
  if (!accountPublicKey) return false;
  try {
    sessionStorage.removeItem(`${MAP_PREFIX}${accountPublicKey}`);
    sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    return true;
  } catch {
    return false;
  }
}

// Wipes every remembered secret across all accounts - the inactivity timeout
// below is global (not tied to whichever account happens to be active), so it
// needs to clear all of them, not just one.
function clearAllSessionSecrets() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith(MAP_PREFIX) || key.startsWith(LEGACY_PREFIX))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    return keysToRemove.length > 0;
  } catch {
    return false;
  }
}

// --- Inactivity timeout (15 minutes) ----------------------------------------
// Self-initializes once this module is first imported (ES modules are
// evaluated only once per page, however many places import it), so no
// wiring is needed at the app's call sites.
let _inactivityTimer = null;

function armInactivityTimer() {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    if (clearAllSessionSecrets()) {
      try {
        window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: {} }));
      } catch { /* noop */ }
    }
  }, INACTIVITY_TIMEOUT_MS);
}

function initInactivityWatcher() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  let lastReset = 0;
  const onActivity = () => {
    const now = Date.now();
    if (now - lastReset < 1000) return; // throttle - no need to rearm on every keystroke
    lastReset = now;
    armInactivityTimer();
  };
  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
  armInactivityTimer();
}

initInactivityWatcher();
