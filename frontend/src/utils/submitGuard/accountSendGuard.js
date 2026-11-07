// Sperre pro Konto bei unklarem Sendestatus (localStorage, je Netz und Quellkonto).
//
// Fuer Sendewege, die eine einzelne Transaktion eines Kontos senden ("Zahlung senden",
// spaeter das Trading). Grundregel fuer beide Sendewege (auch die Sammelzahlung):
// - Unklar sperrt das Konto im Netz. Ein unklarer Eintrag (eigener oder einer der
//   Sammelzahlung, skm_batch_sent_v1, mit Quellkonto) sperrt jedes Senden vom selben Konto.
// - Ein Pin der Sequence (notApplied mit pin) gilt fuer das Konto im Netz, nicht fuer den
//   Sendeweg: Die naechste Transaktion von diesem Konto muss genau die gepinnte Sequence
//   nutzen (findAccountPins, applyAccountPins), sonst strenger Pfad. Der Pin verfaellt erst,
//   wenn die Sequence verbraucht ist (releasePins).
// - Ein unlesbarer Eintrag der Sammelzahlung laesst sich keinem Konto zuordnen und sperrt
//   daher jedes Konto im Netz des Eintrags (Netz unbekannt: alle Netze).
//
// Ein Eintrag hat Hash, Quellkonto, Sequence, maxTime, Netz, Zeitpunkt, Ursache und die
// oeffentlichen Daten der Zahlung (fuer Anzeige und Vermerk nach der Klaerung). Wie in der
// Sammelzahlung wird kein signiertes XDR gespeichert und nie ein Secret Key: Felder, in
// denen etwas wie ein Secret Key steckt, werden verworfen. Die signierte Transaktion fuer
// "Erneut senden" (gleicher Hash) liegt nur im Arbeitsspeicher dieses Tabs.
//
// Status wie in der Sammelzahlung: 'ambiguous' (sperrt), 'notApplied' (laut Horizon nicht
// ausgefuehrt; mit pin muss die naechste Transaktion genau die Sequence seq nutzen),
// 'success' (laut Horizon angewendet). Ein vorhandener, aber unlesbarer Eintrag sperrt
// (fail-closed). Er wird einmal als { status: 'unreadable', seenAt } festgehalten, damit
// die Pruefung ueber Horizon ihn nach Ablauf jeder moeglichen Gueltigkeit freigeben kann.
import { StrKey, hash as sha256 } from '@stellar/stellar-sdk';
import {
  BATCH_SENT_PREFIX, NOT_APPLIED_RETENTION_MS, containsSecretKey, listSentEntryKeys, readSentEntryByKey,
  sanitizeSentEntry, writeSentEntryByKey,
} from '../batchPayment/batchPaymentStore.js';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, AMBIGUOUS_STRICT_RECHECK_MS, lookupTransaction, pinnedSendAccount,
  resolveAmbiguousDetailed, settleAmbiguousEntry,
} from './ambiguousResolve.js';

export const PENDING_TX_PREFIX = 'skm_pending_tx_v1:';
// Erstes Erkennen eines unlesbaren Eintrags der Sammelzahlung (der Eintrag selbst bleibt
// unveraendert stehen): skm_unreadable_seen_v1:<Schluessel des Eintrags>.
export const UNREADABLE_SEEN_PREFIX = 'skm_unreadable_seen_v1:';
// Herkunft eines Eintrags (welcher Sendeweg). Weitere Wege (z.B. 'trade') hier ergaenzen.
const ORIGINS = ['payment'];
const CAUSE_KINDS = ['network', 'timeout', 'server'];
// Warum ein frueher als nicht ausgefuehrt gefuehrter Eintrag wieder unklar ist.
const RECHECK_REASONS = ['pinConsumed', 'badSeq'];
const HASH_RE = /^[0-9a-f]{64}$/i;
const MAX_TEXT = 200;
const SUCCESS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_FIELDS = ['dest', 'amount', 'assetKey', 'memoType', 'memoVal'];
const SUMMARY_FIELDS = ['recipient', 'recipientFederation', 'recipientLabel', 'sourceFederation', 'sourceLabel', 'amountDisplay', 'asset', 'memo'];

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const sha256Hex = (text) => hex(sha256(new TextEncoder().encode(String(text))));

// localStorage-Schluessel: Netz plus sha256 des Kontos (keine Adresse im Klartext).
export function accountEntryKey(network, account) {
  return `${PENDING_TX_PREFIX}${network}:${sha256Hex(String(account || '').trim())}`;
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return containsSecretKey(s) ? '' : s.slice(0, MAX_TEXT);
}

function cleanFields(raw, fields) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const f of fields) {
    if (raw[f] !== undefined && raw[f] !== null) out[f] = cleanText(raw[f]);
  }
  return out;
}

function sanitizeCause(raw) {
  if (!raw || typeof raw !== 'object' || !CAUSE_KINDS.includes(raw.kind)) return undefined;
  const status = Number(raw.status);
  return { kind: raw.kind, status: Number.isInteger(status) && status >= 100 && status < 600 ? status : null };
}

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Prueft einen gespeicherten Eintrag. Ergebnis: Eintrag, Platzhalter fuer "unlesbar"
 * ({ status: 'ambiguous', unreadable: true, seenAt, ledgerSeenAt?, hash? }) oder null, wenn er
 * nicht zu Netz und Konto passt oder kaputt ist.
 */
export function sanitizeAccountEntry(raw, network, account) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.status === 'unreadable') {
    const seenAt = positive(raw.seenAt);
    if (!seenAt) return null;
    const out = { status: 'ambiguous', unreadable: true, seenAt };
    const ledgerSeenAt = positive(raw.ledgerSeenAt);
    if (ledgerSeenAt) out.ledgerSeenAt = ledgerSeenAt;
    const h = String(raw.hash || '');
    if (HASH_RE.test(h)) out.hash = h.toLowerCase();
    return out;
  }
  const core = sanitizeSentEntry(raw);
  if (!core) return null;
  // Eintrag gehoert genau zu diesem Netz und Konto, mit Sequence (sonst kein Pin und keine
  // sichere Aufloesung).
  if (String(raw.network || '') !== network || core.source !== String(account || '').trim() || !core.seq) return null;
  const entry = { ...core, network, origin: ORIGINS.includes(raw.origin) ? raw.origin : 'payment' };
  const cause = sanitizeCause(raw.cause);
  if (cause) entry.cause = cause;
  if (core.status === 'ambiguous' && RECHECK_REASONS.includes(raw.recheck)) entry.recheck = raw.recheck;
  const payment = cleanFields(raw.payment, PAYMENT_FIELDS);
  if (payment) entry.payment = payment;
  const summary = cleanFields(raw.summary, SUMMARY_FIELDS);
  if (summary) {
    summary.activated = raw.summary.activated === true;
    summary.muxedActivationCapture = raw.summary.muxedActivationCapture === true;
    entry.summary = summary;
  }
  return entry;
}

// Erste Sichtung unlesbarer Eintraege, falls sie nicht geschrieben werden konnte.
const unreadableSeen = new Map();

/**
 * Eintrag eines Kontos, immer frisch aus dem Speicher. null, wenn keiner da ist. Ein
 * unlesbarer Eintrag kommt als { status: 'ambiguous', unreadable: true, seenAt } zurueck und
 * wird beim ersten Lesen mit dem Zeitpunkt festgehalten (ein lesbarer Hash bleibt erhalten).
 */
export function readAccountEntry(network, account, now = Date.now()) {
  const key = accountEntryKey(network, account);
  let raw;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* unlesbar */ }
  const entry = sanitizeAccountEntry(parsed, network, account);
  if (entry) return entry;
  const salvaged = parsed && typeof parsed === 'object' && HASH_RE.test(String(parsed.hash || '')) ? String(parsed.hash).toLowerCase() : '';
  const seenAt = unreadableSeen.get(key) || now;
  const record = { v: 1, status: 'unreadable', seenAt, ...(salvaged ? { hash: salvaged } : {}) };
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
    unreadableSeen.delete(key);
  } catch {
    unreadableSeen.set(key, seenAt);
  }
  return { status: 'ambiguous', unreadable: true, seenAt, ...(salvaged ? { hash: salvaged } : {}) };
}

/** Schreibt (entry) oder loescht (null) den Eintrag mit einem setItem. false bei Fehler. */
export function writeAccountEntry(network, account, entry) {
  const key = accountEntryKey(network, account);
  try {
    if (!entry) {
      window.localStorage.removeItem(key);
      return true;
    }
    const clean = sanitizeAccountEntry({ ...entry, network, v: 1 }, network, account);
    if (!clean || clean.unreadable) return false;
    const { unreadable: _u, ...stored } = clean;
    window.localStorage.setItem(key, JSON.stringify({ v: 1, ...stored }));
    return true;
  } catch {
    return false;
  }
}

// Zuletzt in diesem Tab bekannte unklare Eintraege (Netz|Konto -> Eintrag). Fehlt der
// Eintrag spaeter im Speicher (Website-Daten geloescht), bleibt das Konto trotzdem gesperrt
// und die Pruefung nutzt diesen Eintrag.
const knownAmbiguous = new Map();
const memKey = (network, account) => `${network}|${String(account || '').trim()}`;

export function rememberAmbiguous(network, account, entry) {
  if (entry?.status === 'ambiguous' && !entry.unreadable && entry.hash) knownAmbiguous.set(memKey(network, account), entry);
}
export function forgetAmbiguous(network, account, hash) {
  const k = memKey(network, account);
  if (!hash || knownAmbiguous.get(k)?.hash === hash) knownAmbiguous.delete(k);
}

// Laufende eigene Submits in diesem Tab (Netz|Konto|Hash). Waehrend des Submits steht der
// eigene Eintrag als unklar im Speicher; er wird dann nicht als "bekannt unklar" gemerkt,
// sonst stellte eine eindeutige Ablehnung danach eine falsche Sperre wieder her.
const submitting = new Set();
export function markSubmitting(network, account, hash, active) {
  const k = `${memKey(network, account)}|${hash}`;
  if (active) submitting.add(k); else submitting.delete(k);
}
const isSubmitting = (network, account, hash) => submitting.has(`${memKey(network, account)}|${hash}`);

// ---- Unlesbare Eintraege der Sammelzahlung ----------------------------------------------

// Netz eines Schluessels der Sammelzahlung: '<Netz>:<sha256>' -> Netz, sonst '*' (unbekannt,
// gilt fuer alle Netze). Die Schreibprobe (isStorageWritable) zaehlt nicht.
function batchKeyNetwork(key) {
  const rest = key.slice(BATCH_SENT_PREFIX.length);
  if (rest === 'probe') return null;
  const m = /^([^:]+):[0-9a-f]{64}$/i.exec(rest);
  return m ? m[1] : '*';
}

/** Schluessel unlesbarer Eintraege der Sammelzahlung, die dieses Netz sperren. */
export function listUnreadableBatchKeys(network) {
  const out = [];
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(BATCH_SENT_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const net = batchKeyNetwork(k);
      if (!net || (net !== '*' && net !== network)) continue;
      const e = readSentEntryByKey(k);
      // Netz unbekannt: auch ein lesbarer unklarer Eintrag laesst sich keinem Netz zuordnen.
      if (e?.unreadable || (net === '*' && e?.status === 'ambiguous')) out.push(k);
    }
  } catch { /* noop */ }
  return out;
}

function readRaw(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/**
 * Unlesbarer Eintrag der Sammelzahlung als Sperre: { status: 'ambiguous', unreadable: true,
 * seenAt, ledgerSeenAt?, hash? (falls lesbar), batchKey }. Das erste Erkennen wird neben dem
 * Eintrag festgehalten (mit sha256 des Inhalts: ein anderer unlesbarer Inhalt gilt als neu).
 */
export function batchUnreadableInfo(key, now = Date.now()) {
  const raw = readRaw(key);
  if (raw === null) return null;
  const digest = sha256Hex(raw);
  const sideKey = `${UNREADABLE_SEEN_PREFIX}${key}`;
  let side = null;
  try { side = JSON.parse(readRaw(sideKey) || 'null'); } catch { /* neu */ }
  if (!side || side.digest !== digest || !positive(side.seenAt)) {
    const seenAt = unreadableSeen.get(sideKey) || now;
    side = { v: 1, digest, seenAt };
    try {
      window.localStorage.setItem(sideKey, JSON.stringify(side));
      unreadableSeen.delete(sideKey);
    } catch {
      unreadableSeen.set(sideKey, seenAt);
    }
  }
  let salvaged = '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && HASH_RE.test(String(parsed.hash || ''))) salvaged = String(parsed.hash).toLowerCase();
  } catch { /* kein Hash */ }
  const ledgerSeenAt = positive(side.ledgerSeenAt);
  return {
    status: 'ambiguous', unreadable: true, seenAt: Number(side.seenAt), batchKey: key, digest,
    ...(ledgerSeenAt ? { ledgerSeenAt } : {}), ...(salvaged ? { hash: salvaged } : {}),
  };
}

function releaseBatchUnreadable(key) {
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${UNREADABLE_SEEN_PREFIX}${key}`);
  } catch { /* bleibt gesperrt */ }
}

/**
 * Ledger-Zeit (Sekunden) beim ersten Erkennen eines unlesbaren Eintrags festhalten (nur,
 * wenn noch keine da ist). block: Sperre aus findAccountSendBlock (single unlesbar oder
 * batchUnreadable). Liefert die gespeicherte Ledger-Zeit (auch eine schon vorhandene).
 */
export function recordUnreadableLedgerSeen(network, account, block, closedSec) {
  const sec = positive(closedSec);
  const entry = block?.entry;
  if (!entry?.unreadable || !sec) return positive(entry?.ledgerSeenAt);
  try {
    if (block.kind === 'batchUnreadable') {
      const sideKey = `${UNREADABLE_SEEN_PREFIX}${entry.batchKey}`;
      const side = JSON.parse(readRaw(sideKey) || 'null');
      if (!side || side.digest !== entry.digest) return null;
      if (positive(side.ledgerSeenAt)) return Number(side.ledgerSeenAt);
      window.localStorage.setItem(sideKey, JSON.stringify({ ...side, ledgerSeenAt: sec }));
      return sec;
    }
    const key = accountEntryKey(network, account);
    const rec = JSON.parse(readRaw(key) || 'null');
    if (rec?.status !== 'unreadable' || Number(rec.seenAt) !== entry.seenAt) return null;
    if (positive(rec.ledgerSeenAt)) return Number(rec.ledgerSeenAt);
    window.localStorage.setItem(key, JSON.stringify({ ...rec, ledgerSeenAt: sec }));
    return sec;
  } catch {
    return null;
  }
}

// ---- Sperre -------------------------------------------------------------------------------

/**
 * Was sperrt das Senden von diesem Konto in diesem Netz? null oder
 * { kind: 'single', entry, missing?, sending? } (eigener Eintrag; missing: nur noch im
 * Arbeitsspeicher; sending: eigener Submit laeuft gerade in diesem Tab),
 * { kind: 'batch', key, entry } (unklarer Eintrag der Sammelzahlung mit diesem Quellkonto) bzw.
 * { kind: 'batchUnreadable', key, entry } (unlesbarer Eintrag der Sammelzahlung im Netz).
 */
export function findAccountSendBlock(network, account) {
  const source = String(account || '').trim();
  if (!network || !StrKey.isValidEd25519PublicKey(source)) return null;
  const own = readAccountEntry(network, source);
  if (own?.status === 'ambiguous') {
    if (!own.unreadable && own.hash && isSubmitting(network, source, own.hash)) return { kind: 'single', entry: own, sending: true };
    rememberAmbiguous(network, source, own);
    return { kind: 'single', entry: own };
  }
  if (!own) {
    const known = knownAmbiguous.get(memKey(network, source));
    if (known) return { kind: 'single', entry: known, missing: true };
  } else {
    forgetAmbiguous(network, source);
  }
  for (const key of listSentEntryKeys(network)) {
    const e = readSentEntryByKey(key);
    if (e?.status === 'ambiguous' && !e.unreadable && e.source === source) return { kind: 'batch', key, entry: e };
  }
  const unreadableKey = listUnreadableBatchKeys(network)[0];
  if (unreadableKey) {
    const info = batchUnreadableInfo(unreadableKey);
    if (info) return { kind: 'batchUnreadable', key: unreadableKey, entry: info };
  }
  return null;
}

/** Sperrt ein eigener Eintrag (unklar oder unlesbar) dieses Konto? Fuer die Sammelzahlung. */
export function accountEntryBlocks(network, account) {
  const source = String(account || '').trim();
  if (!StrKey.isValidEd25519PublicKey(source)) return false;
  if (readAccountEntry(network, source)?.status === 'ambiguous') return true;
  return knownAmbiguous.has(memKey(network, source)) && !readAccountEntry(network, source);
}

/**
 * Sperre einer Zeile der Sammelzahlung durch andere Eintraege der Sammelzahlung:
 * 'logUnreadable' (unlesbarer Eintrag im Netz, sperrt alle Konten), 'sourceAmbiguous'
 * (anderer unklarer Eintrag desselben Senders) oder null. exceptKeys: Schluessel der Zeile
 * selbst (Haupt- und Routing-Eintrag), deren Status die Zeile selbst anzeigt.
 */
export function batchAccountBlock(network, account, exceptKeys = []) {
  const source = String(account || '').trim();
  const except = new Set(exceptKeys.filter(Boolean));
  let reason = null;
  for (const key of listSentEntryKeys(network)) {
    if (except.has(key)) continue;
    const e = readSentEntryByKey(key);
    if (e?.unreadable) return 'logUnreadable';
    if (e?.status === 'ambiguous' && e.source === source) reason = 'sourceAmbiguous';
  }
  if (listUnreadableBatchKeys(network).some((k) => !except.has(k))) return 'logUnreadable';
  return reason;
}

// ---- Pin pro Konto ------------------------------------------------------------------------

/**
 * Offene Pins des Kontos im Netz aus beiden Speichern: [{ store: 'account'|'batch', key, entry }].
 * Ein Pin ist ein Eintrag 'notApplied' mit pin und Sequence.
 */
export function findAccountPins(network, account) {
  const source = String(account || '').trim();
  if (!network || !StrKey.isValidEd25519PublicKey(source)) return [];
  const out = [];
  const own = readAccountEntry(network, source);
  if (own?.status === 'notApplied' && own.pin && own.seq) out.push({ store: 'account', key: accountEntryKey(network, source), entry: own });
  for (const key of listSentEntryKeys(network)) {
    const e = readSentEntryByKey(key);
    if (e?.status === 'notApplied' && e.pin && e.seq && e.source === source) out.push({ store: 'batch', key, entry: e });
  }
  return out;
}

function readPinEntry(network, account, pin) {
  return pin.store === 'account' ? readAccountEntry(network, account) : readSentEntryByKey(pin.key);
}
function writePinEntry(network, account, pin, entry) {
  return pin.store === 'account' ? writeAccountEntry(network, account, entry) : writeSentEntryByKey(pin.key, entry);
}

/**
 * Konto fuer die naechste Transaktion bei offenen Pins: { account, pinned, pinSeq } oder
 * { blocked: [Pins] }, wenn ein Pin nicht genau zur Konto-Sequence passt (verbraucht oder
 * Konto weiter darunter). Ohne Pins { account: loaded, pinned: false }.
 */
export function applyAccountPins({ loaded, source, pins }) {
  if (!pins?.length) return { account: loaded, pinned: false, pinSeq: null };
  const checked = pins.map((p) => ({ p, r: pinnedSendAccount({ account: loaded, source, pinSeq: p.entry.seq }) }));
  const blocked = checked.filter((x) => x.r.consumed).map((x) => x.p);
  if (blocked.length) return { blocked };
  return { account: checked[0].r.account, pinned: true, pinSeq: String(pins[0].entry.seq) };
}

/**
 * Einen Pin wieder als unklar fuehren (strenger Pfad beim Aufloesen), nur wenn dort noch
 * derselbe Eintrag steht. reason: 'pinConsumed' | 'badSeq'.
 */
export function markPinRecheck(network, account, pin, reason) {
  const source = String(account || '').trim();
  const cur = readPinEntry(network, source, pin);
  if (cur?.status !== 'notApplied' || cur.hash !== pin.entry.hash) return false;
  const next = { ...cur, status: 'ambiguous', pin: false, recheck: reason };
  const ok = writePinEntry(network, source, pin, next);
  if (pin.store === 'account') rememberAmbiguous(network, source, next);
  return ok;
}

/**
 * Sequence seq dieses Kontos ist verbraucht (eigene Transaktion im Ledger, erfolgreich oder
 * fehlgeschlagen): Pins mit dieser Sequence sind erledigt, die frueheren Transaktionen
 * koennen nicht mehr angewendet werden.
 */
export function releasePins(network, account, seq) {
  if (!seq) return;
  const source = String(account || '').trim();
  for (const p of findAccountPins(network, source)) {
    if (String(p.entry.seq) === String(seq)) writePinEntry(network, source, p, { ...p.entry, pin: false });
  }
}

// ---- Aufloesung ---------------------------------------------------------------------------

// Gleiche Felder wie der Eintrag, damit Anzeige und Vermerk auch nach der Klaerung stimmen.
const keepFields = (e) => ({
  network: e.network, origin: e.origin, cause: e.cause, payment: e.payment, summary: e.summary,
});

/**
 * Prueft eine Sperre ueber Horizon (Netz des Eintrags, nicht das globale) und schreibt das
 * Ergebnis zurueck. Regeln wie in der Sammelzahlung (settleAmbiguousEntry). Ergebnis
 * { outcome, entry } mit outcome success | failed | expired | pending | unknown oder null.
 * maxValiditySeconds: laengste Gueltigkeit, die dieser Sendeweg setzt (fuer eigene unlesbare
 * Eintraege), batchMaxValiditySeconds: dasselbe fuer die Sammelzahlung.
 */
export async function settleAccountBlock({
  network, account, block, server, maxValiditySeconds, batchMaxValiditySeconds = maxValiditySeconds,
  resolve = resolveAmbiguousDetailed, strictDelayMs = AMBIGUOUS_STRICT_RECHECK_MS, sleep,
}) {
  const source = String(account || '').trim();
  if (!block) return { outcome: null, entry: null };
  const onConsumed = (e) => { if (e?.seq && e?.source) releasePins(network, e.source, e.seq); };
  if (block.kind === 'batch') {
    return settleAmbiguousEntry({
      server, resolve, onConsumed,
      read: () => readSentEntryByKey(block.key),
      write: (e) => writeSentEntryByKey(block.key, e),
    });
  }
  if (block.kind === 'batchUnreadable') {
    return settleBatchUnreadable({ key: block.key, server, maxValiditySeconds: batchMaxValiditySeconds, strictDelayMs, sleep });
  }
  if (block.entry?.unreadable) {
    const key = accountEntryKey(network, source);
    return settleUnreadable({
      server, entry: block.entry, maxValiditySeconds, strictDelayMs, sleep,
      stillSame: () => {
        try {
          const raw = JSON.parse(readRaw(key) || 'null');
          return raw?.status === 'unreadable' && Number(raw.seenAt) === block.entry.seenAt;
        } catch {
          return false;
        }
      },
      release: () => writeAccountEntry(network, source, null),
      recordLedgerSeen: (sec) => recordUnreadableLedgerSeen(network, source, block, sec),
    });
  }
  // Eintrag fehlt im Speicher: zuerst wiederherstellen (sperrt weiter), dann pruefen.
  if (block.missing && !readAccountEntry(network, source)) writeAccountEntry(network, source, block.entry);
  const res = await settleAmbiguousEntry({
    server, resolve, extra: keepFields, onConsumed,
    read: () => readAccountEntry(network, source) || (block.missing ? block.entry : null),
    write: (e) => writeAccountEntry(network, source, e),
  });
  if (res.outcome && res.outcome !== 'pending' && res.outcome !== 'unknown') forgetAmbiguous(network, source, block.entry.hash);
  return res;
}

/**
 * Unlesbarer Eintrag der Sammelzahlung (Schluessel key): wie settleUnreadable, frei wird er
 * durch Entfernen des Eintrags.
 */
export async function settleBatchUnreadable({ key, server, maxValiditySeconds, strictDelayMs = AMBIGUOUS_STRICT_RECHECK_MS, sleep }) {
  const entry = batchUnreadableInfo(key);
  if (!entry) return { outcome: 'expired', entry: null };
  const block = { kind: 'batchUnreadable', key, entry };
  return settleUnreadable({
    server, entry, maxValiditySeconds, strictDelayMs, sleep,
    stillSame: () => {
      const raw = readRaw(key);
      return raw !== null && sha256Hex(raw) === entry.digest;
    },
    release: () => releaseBatchUnreadable(key),
    recordLedgerSeen: (sec) => recordUnreadableLedgerSeen('', '', block, sec),
  });
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestClosedSeconds(server) {
  try {
    const ledgers = await server.ledgers().order('desc').limit(1).call();
    return Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
  } catch {
    return NaN;
  }
}

/**
 * Unlesbarer Eintrag: Hash (falls lesbar) bei Horizon suchen. Im Ledger erfolgreich oder
 * fehlgeschlagen ist eindeutig (Sequence verbraucht): Sperre aufheben. Sonst gilt: Er wurde
 * vor dem Senden geschrieben, die Transaktion ist also spaetestens beim ersten Erkennen plus
 * maxValiditySeconds abgelaufen. Erstes Erkennen = Maximum aus lokaler Zeit (seenAt) und
 * Ledger-Zeit (ledgerSeenAt, beim Erkennen bzw. spaetestens bei dieser Pruefung
 * festgehalten). Freigabe erst, wenn zwei Abfragen im Abstand von mindestens 30 s einen
 * Ledger nach diesem Zeitpunkt plus Puffer melden (Ledger-Zeit, nicht die lokale Uhr).
 * Ohne maxValiditySeconds bleibt er gesperrt.
 */
async function settleUnreadable({
  server, entry, maxValiditySeconds, strictDelayMs, sleep = sleepMs, stillSame, release, recordLedgerSeen,
}) {
  const settled = (outcome) => {
    if (stillSame()) release();
    return { outcome, entry: { hash: entry.hash, status: outcome } };
  };
  if (entry.hash) {
    const r = await lookupTransaction(server, entry.hash);
    if (r === 'success' || r === 'failed') return settled(r);
    if (r === 'unknown') return { outcome: 'unknown', entry };
  }
  const validity = Number(maxValiditySeconds);
  if (!Number.isFinite(validity) || validity <= 0 || !Number.isFinite(entry.seenAt)) return { outcome: 'unknown', entry };
  const closed1 = await latestClosedSeconds(server);
  if (!Number.isFinite(closed1)) return { outcome: 'unknown', entry };
  let ledgerSeen = positive(entry.ledgerSeenAt);
  if (!ledgerSeen) ledgerSeen = positive(recordLedgerSeen?.(closed1)) || closed1;
  const limit = Math.max(entry.seenAt / 1000, ledgerSeen) + validity + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
  if (closed1 <= limit) return { outcome: 'pending', entry, clearAt: limit * 1000 };
  await sleep(strictDelayMs);
  if (entry.hash) {
    const r2 = await lookupTransaction(server, entry.hash);
    if (r2 === 'success' || r2 === 'failed') return settled(r2);
    if (r2 !== 'notFound') return { outcome: 'unknown', entry };
  }
  const closed2 = await latestClosedSeconds(server);
  if (!Number.isFinite(closed2)) return { outcome: 'unknown', entry };
  if (closed2 <= limit) return { outcome: 'pending', entry, clearAt: limit * 1000 };
  if (stillSame()) release();
  return { outcome: 'expired', entry: null };
}

/**
 * Entfernt erfolgreiche Eintraege nach 7 Tagen und nicht ausgefuehrte (auch mit Pin) nach
 * 30 Tagen (wie in der Sammelzahlung). Unklare und unlesbare bleiben.
 */
export function pruneAccountEntries(now = Date.now()) {
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PENDING_TX_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      let entry = null;
      try { entry = sanitizeSentEntry(JSON.parse(window.localStorage.getItem(k) || 'null')); } catch { /* bleibt */ }
      if (!entry) continue;
      if (entry.status === 'success' && now - entry.at > SUCCESS_RETENTION_MS) window.localStorage.removeItem(k);
      else if (entry.status === 'notApplied' && now - entry.at > NOT_APPLIED_RETENTION_MS) window.localStorage.removeItem(k);
    }
  } catch { /* noop */ }
}

// Signierte Transaktion und Diagnose des letzten unklaren Sendens, nur im Arbeitsspeicher
// dieses Tabs (kein Secret: eine signierte Transaktion kann nur genau so angewendet werden).
const signedMemory = new Map();

export function rememberSignedTx(network, account, { hash, xdr, networkPassphrase }) {
  if (!hash || !xdr) return;
  const k = memKey(network, account);
  signedMemory.set(k, { ...(signedMemory.get(k)?.hash === hash ? signedMemory.get(k) : {}), hash, xdr, networkPassphrase });
}
export function rememberDiagnostics(network, account, hash, diag) {
  const k = memKey(network, account);
  const cur = signedMemory.get(k);
  signedMemory.set(k, { ...(cur?.hash === hash ? cur : { hash }), diag });
}
/** Signierte Transaktion mit genau diesem Hash oder null. */
export function signedTxFor(network, account, hash) {
  const cur = signedMemory.get(memKey(network, account));
  return cur && cur.hash === hash ? cur : null;
}
export function forgetSignedTx(network, account) {
  signedMemory.delete(memKey(network, account));
}

/** Nur fuer Tests: Arbeitsspeicher leeren (wie ein Neuladen der Seite). */
export function resetAccountSendGuardMemory() {
  knownAmbiguous.clear();
  signedMemory.clear();
  unreadableSeen.clear();
  submitting.clear();
}
