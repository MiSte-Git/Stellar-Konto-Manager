// Speicher der Sammelzahlung (localStorage, pro Netz getrennt).
//
// 1. Die Liste (Zeilen): Sender, Empfaenger, Asset, Betrag, Memo. Nur oeffentliche Daten.
// 2. Das Sende-Protokoll: pro Zahlung (Fingerprint aus dem tatsaechlichen
//    Transaktionsinhalt) Hash, Zeitpunkt, Status und maxTime der Transaktion. Es ist von
//    den Zeilen getrennt, damit Entfernen oder Neueingeben einer Zeile den Schutz gegen
//    Doppelzahlung nicht aufhebt. Jede Zahlung hat einen eigenen localStorage-Schluessel
//    (sha256 des Fingerprints, keine Adressen im Klartext), geschrieben mit genau einem
//    setItem: Zwei Tabs koennen sich so keine fremden Eintraege ueberschreiben.
//
// Secret Keys werden nie gespeichert: Jeder Wert, in dem etwas wie ein Secret Key steckt
// (auch mit Praefix, Suffix oder Leerzeichen), wird beim Speichern und Laden verworfen.
import { StrKey, hash as sha256 } from '@stellar/stellar-sdk';

export const BATCH_PAYMENT_STORAGE_KEY = 'skm_batch_payment_v1';
export const BATCH_SENT_PREFIX = 'skm_batch_sent_v1:';
export const MEMO_TYPES = ['none', 'text', 'id', 'hash', 'return'];
export const MAX_ROWS = 50;
// Eine Zahlung mit genau demselben Inhalt gilt so lange als "schon gesendet".
export const RESEND_WINDOW_MS = 20 * 60 * 60 * 1000;
// Erfolgreiche Eintraege werden danach aus dem Protokoll entfernt.
const SENT_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FIELD_LENGTH = 200;

let idCounter = 0;
function newRowId() {
  idCounter += 1;
  return `r${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// Steckt in dem Wert irgendwo ein Secret Key? Nach Unicode-Normalisierung (NFKC, z.B.
// Vollbreite) werden gueltige G-/M-Adressen aus dem Text entfernt (auch mit Zusatz wie
// "G... (Konto A)"), danach alle Zeichen ausser A-Z und 0-9 (Trennzeichen, Satzzeichen,
// unsichtbare Format- und Kombinationszeichen). Die Ziffern 0, 1, 8, 9 kommen in Base32
// nicht vor und trennen weiter. Bei einer Federation-Adresse name*domain werden Name und
// jedes Domain-Label einzeln geprueft, damit lange gueltige Domains kein Treffer sind.
const PUBLIC_KEY_RE = /[GM][A-Z2-7]{55,68}/g;
const FEDERATION_RE = /^([^*\s]+)\*([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;

function stripPublicKeys(text) {
  return text.replace(PUBLIC_KEY_RE, (t) => {
    if (StrKey.isValidEd25519PublicKey(t) || StrKey.isValidMed25519PublicKey(t)) return ' ';
    // Laengerer Treffer (Adresse plus angehaengte Buchstaben): gueltige G-Adresse am Anfang?
    const g = t.slice(0, 56);
    return StrKey.isValidEd25519PublicKey(g) ? ` ${t.slice(56)}` : t;
  });
}

function hasSecretPattern(text) {
  return /S[A-Z2-7]{55}/.test(stripPublicKeys(text.toUpperCase()).replace(/[^A-Z0-9]/g, ''));
}

export function containsSecretKey(value) {
  const raw = String(value ?? '').normalize('NFKC');
  if (!raw.trim()) return false;
  const fed = raw.trim().match(FEDERATION_RE);
  if (fed) return hasSecretPattern(fed[1]) || fed[2].split(/[.-]/).some(hasSecretPattern);
  return hasSecretPattern(raw);
}

function cleanField(value) {
  const s = typeof value === 'string' ? value : (value == null ? '' : String(value));
  if (containsSecretKey(s)) return '';
  return s.slice(0, MAX_FIELD_LENGTH);
}

export function createEmptyRow(overrides = {}) {
  return {
    id: newRowId(),
    source: '',
    dest: '',
    assetKey: 'XLM',
    amount: '',
    memoType: 'text',
    memoVal: '',
    ...overrides,
  };
}

export function sanitizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const memoType = MEMO_TYPES.includes(raw.memoType) ? raw.memoType : 'text';
  const id = cleanField(raw.id).slice(0, 40);
  return {
    id: /^[A-Za-z0-9_-]+$/.test(id) ? id : newRowId(),
    source: cleanField(raw.source).trim(),
    dest: cleanField(raw.dest).trim(),
    assetKey: cleanField(raw.assetKey).trim() || 'XLM',
    amount: cleanField(raw.amount),
    memoType,
    memoVal: cleanField(raw.memoVal),
  };
}

function readJson(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (parsed && typeof parsed === 'object' && parsed.networks && typeof parsed.networks === 'object') return parsed;
  } catch { /* noop */ }
  return { version: 1, networks: {} };
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadBatchRows(network) {
  const all = readJson(BATCH_PAYMENT_STORAGE_KEY);
  const list = Array.isArray(all.networks[network]) ? all.networks[network] : [];
  return list.slice(0, MAX_ROWS).map(sanitizeRow).filter(Boolean);
}

export function saveBatchRows(network, rows) {
  if (!network) return false;
  const all = readJson(BATCH_PAYMENT_STORAGE_KEY);
  all.version = 1;
  all.networks[network] = (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map(sanitizeRow).filter(Boolean);
  return writeJson(BATCH_PAYMENT_STORAGE_KEY, all);
}

// Kann localStorage geschrieben werden? Ohne Speicher fehlt der Schutz gegen Doppelzahlung.
export function isStorageWritable() {
  try {
    const probe = `${BATCH_SENT_PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// Betrag in kanonischer Form (Punkt, ohne fuehrende/abschliessende Nullen) oder null.
// Ein Apostroph gilt als Tausendertrennzeichen (1'000), Komma als Dezimaltrennzeichen.
export function normalizeAmount(raw) {
  const s = String(raw ?? '').trim().replace(/'/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,7})?$/.test(s)) return null;
  const [intPart, frac = ''] = s.split('.');
  const intClean = intPart.replace(/^0+(?=\d)/, '');
  const fracClean = frac.replace(/0+$/, '');
  const out = fracClean ? `${intClean}.${fracClean}` : intClean;
  if (!/[1-9]/.test(out)) return null; // 0 ist kein gueltiger Betrag
  // Stellar-Maximum: int64 in Stroops
  const stroops = BigInt(intClean) * 10000000n + BigInt((fracClean + '0000000').slice(0, 7));
  if (stroops > 9223372036854775807n) return null;
  return out;
}

// Sieht aus wie ein Betrag mit Tausenderpunkten (1.000, 12.500.000)? Dann Hinweis zeigen.
export function looksLikeThousandsSeparator(raw) {
  return /^\d{1,3}([.,]\d{3})+$/.test(String(raw ?? '').trim()) && /\./.test(String(raw));
}

function sanitizeSentEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const at = Number(raw.at);
  const status = raw.status === 'ambiguous' || raw.status === 'success' ? raw.status : null;
  const hash = String(raw.hash || '');
  if (!status || !Number.isFinite(at) || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const entry = { hash: hash.toLowerCase(), at, status };
  const maxTime = Number(raw.maxTime);
  if (Number.isInteger(maxTime) && maxTime > 0) entry.maxTime = maxTime;
  return entry;
}

// localStorage-Schluessel einer Zahlung: Netz plus sha256 des Fingerprints.
export function sentEntryKey(network, fingerprint) {
  const digest = sha256(new TextEncoder().encode(String(fingerprint)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${BATCH_SENT_PREFIX}${network}:${hex}`;
}

/** Eintrag des Sende-Protokolls, immer frisch aus dem Speicher. */
export function readSentEntry(network, fingerprint) {
  try {
    return sanitizeSentEntry(JSON.parse(window.localStorage.getItem(sentEntryKey(network, fingerprint)) || 'null'));
  } catch {
    return null;
  }
}

/**
 * Schreibt (entry) oder loescht (null) den Eintrag einer Zahlung sofort mit einem
 * einzigen setItem/removeItem. Liefert false, wenn nicht geschrieben werden konnte.
 */
export function writeSentEntry(network, fingerprint, entry) {
  const key = sentEntryKey(network, fingerprint);
  try {
    if (!entry) {
      window.localStorage.removeItem(key);
      return true;
    }
    const clean = sanitizeSentEntry(entry);
    if (!clean) return false;
    window.localStorage.setItem(key, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// Entfernt erfolgreiche Eintraege nach der Aufbewahrungszeit. Unklare bleiben stehen.
export function pruneSentLog(now = Date.now()) {
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(BATCH_SENT_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      let entry = null;
      try { entry = sanitizeSentEntry(JSON.parse(window.localStorage.getItem(k) || 'null')); } catch { /* defekt */ }
      if (!entry || (entry.status === 'success' && now - entry.at > SENT_LOG_RETENTION_MS)) window.localStorage.removeItem(k);
    }
  } catch { /* noop */ }
}

// Bereits gesendet (innerhalb des Fensters) oder Status unklar? Sonst null.
export function recentSendOf(entry, now = Date.now()) {
  if (!entry) return null;
  if (entry.status === 'ambiguous') return entry;
  if (now - entry.at > RESEND_WINDOW_MS) return null;
  return entry;
}
