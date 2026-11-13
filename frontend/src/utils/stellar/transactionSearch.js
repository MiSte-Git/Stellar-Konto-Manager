// Filtersuche ueber Operationen eines Kontos (Menue: Transaktionen durchsuchen).
// Reine Logik: Operationen einmal laden und vereinheitlichen, danach beliebig oft filtern und sortieren.
// Verknuepfung: ODER innerhalb einer Gruppe (mehrere Memos, mehrere Empfaenger), UND zwischen
// den Gruppen Memo, Memo nicht, falsches Memo, Empfaenger, Betrag und Richtung. Leere Gruppen zaehlen nicht.
import { StrKey } from '@stellar/stellar-sdk';
import { ADDRESS_KINDS, classifyStellarAddress } from './addressType.js';
import { cleanMemo, withRetry } from './queryUtils.js';

export const SEARCH_ABORT_MESSAGE = 'submitTransaction.failed:cache.backfill.aborted';
export const MAX_FILTER_ENTRIES = 100;
// 250 Seiten zu 200 Eintraegen: darueber wird die Treffermenge als unvollstaendig gemeldet
export const MAX_PAGES = 250;

const SEARCH_TYPES = new Set([
  'payment',
  'path_payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
  'create_account',
  'account_merge',
  'create_claimable_balance',
]);

const STROOPS_PER_UNIT = 10_000_000n;

// "1,5" und "1.5" gelten gleich, hoechstens 7 Nachkommastellen, keine Tausendertrenner.
// Gibt BigInt (Stroops) zurueck oder null bei ungueltiger Eingabe.
export function parseStroops(input) {
  const s = String(input ?? '').trim();
  const m = /^(\d+)(?:[.,](\d{1,7}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] || '').padEnd(7, '0');
  return BigInt(m[1]) * STROOPS_PER_UNIT + BigInt(frac);
}

export function formatStroops(stroops) {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = String(abs % STROOPS_PER_UNIT).padStart(7, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function assetLabel(assetKey) {
  if (!assetKey || assetKey === 'native') return 'XLM';
  return assetKey.split(':')[0];
}

// Eingaben erscheinen in Fehlermeldungen. Ein versehentlich eingefuegter Secret Key (S...)
// darf dort nie stehen, auch nicht in einem anderen Feld.
const SECRET_LIKE = /S[A-Z2-7]{55}/g;
function safeEcho(value, max = 60) {
  return String(value ?? '').replace(SECRET_LIKE, '***').slice(0, max);
}

function splitList(text, separator) {
  const seen = new Set();
  const out = [];
  for (const part of String(text ?? '').split(separator)) {
    const v = part.trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// Ein Empfaenger-Eintrag: G- oder M-Adresse. Ergebnis { kind, value } oder { error, value }.
// Secret Keys werden nie zurueckgegeben (weder als value noch in params).
export function parseRecipient(token) {
  const tok = String(token ?? '').trim();
  const addressKind = classifyStellarAddress(tok);
  if (addressKind === ADDRESS_KINDS.ACCOUNT) return { kind: 'G', value: tok };
  if (addressKind === ADDRESS_KINDS.MUXED) return { kind: 'M', value: tok };
  if (StrKey.isValidEd25519SecretSeed(tok)) return { error: 'recipientSecretKey' };
  return { error: 'recipientInvalid', value: safeEcho(tok) };
}

// raw: { memosText, notMemosText, notExactMemosText, recipientsText, amountAsset: 'native'|'custom', assetCode, assetIssuer,
//        amountMin, amountMax, direction: 'all'|'in'|'out' }
// Ergebnis: { ok: true, filters } oder { ok: false, errors: [{ key, params }] }
export function buildSearchFilters(raw = {}) {
  const errors = [];
  const memos = splitList(raw.memosText, /\r?\n/).map(cleanMemo).filter(Boolean);
  const notMemos = splitList(raw.notMemosText, /\r?\n/).map(cleanMemo).filter(Boolean);
  // Erwartete Memos fuer "falsches Memo": jede Abweichung zaehlt (Gross-/Kleinschreibung, Tippfehler, leer)
  const notExactMemos = splitList(raw.notExactMemosText, /\r?\n/).map(cleanMemo).filter(Boolean);
  if (memos.length > MAX_FILTER_ENTRIES || notMemos.length > MAX_FILTER_ENTRIES || notExactMemos.length > MAX_FILTER_ENTRIES) {
    errors.push({ key: 'tooManyMemos', params: { max: MAX_FILTER_ENTRIES } });
  }

  const recipients = [];
  const recipientTokens = splitList(raw.recipientsText, /[\s,;]+/);
  if (recipientTokens.length > MAX_FILTER_ENTRIES) {
    errors.push({ key: 'tooManyRecipients', params: { max: MAX_FILTER_ENTRIES } });
  }
  for (const tok of recipientTokens) {
    const res = parseRecipient(tok);
    if (res.error) errors.push({ key: res.error, params: res.error === 'recipientInvalid' ? { value: res.value } : {} });
    else recipients.push(res);
  }

  const minText = String(raw.amountMin ?? '').trim();
  const maxText = String(raw.amountMax ?? '').trim();
  const min = minText ? parseStroops(minText) : null;
  const max = maxText ? parseStroops(maxText) : null;
  if (minText && min === null) errors.push({ key: 'amountInvalid', params: { value: safeEcho(minText, 40) } });
  if (maxText && max === null) errors.push({ key: 'amountInvalid', params: { value: safeEcho(maxText, 40) } });
  if (min !== null && max !== null && min > max) errors.push({ key: 'amountRange', params: {} });

  let assetKey = 'native';
  if (raw.amountAsset === 'custom') {
    const code = String(raw.assetCode ?? '').trim();
    const issuer = String(raw.assetIssuer ?? '').trim();
    if (min !== null || max !== null) {
      if (!/^[A-Za-z0-9]{1,12}$/.test(code)) errors.push({ key: 'assetCodeInvalid', params: {} });
      if (!StrKey.isValidEd25519PublicKey(issuer)) errors.push({ key: 'assetIssuerInvalid', params: {} });
    }
    assetKey = `${code}:${issuer}`;
  }

  const direction = raw.direction === 'in' || raw.direction === 'out' ? raw.direction : 'all';
  if (errors.length) return { ok: false, errors };

  const amount = (min !== null || max !== null) ? { assetKey, min, max } : null;
  return { ok: true, filters: { memos, notMemos, notExactMemos, recipients, amount, direction } };
}

export function hasAnyFilter(filters) {
  return !!(filters && (filters.memos.length || filters.notMemos.length || filters.notExactMemos.length || filters.recipients.length || filters.amount || filters.direction !== 'all'));
}

function assetKeyOf(r, prefix = '') {
  const type = r[`${prefix}asset_type`];
  if (!type || type === 'native') return 'native';
  return `${r[`${prefix}asset_code`] || ''}:${r[`${prefix}asset_issuer`] || ''}`;
}

// Eine Horizon-Operation zu einer Zeile. null = Typ gehoert nicht zur Suche.
// Betrag bei Tausch (path_payment): gesendeter Betrag (source_amount) im gesendeten Asset.
// account_merge liefert keinen Betrag (stroops null).
export function normalizeOperation(r, accountId) {
  const type = String(r?.type || '');
  if (!SEARCH_TYPES.has(type)) return null;

  let from = '';
  let recipients = [];
  let amount = null;
  let assetKey = 'native';

  if (type === 'payment') {
    from = r.from || '';
    recipients = [{ g: r.to || '', m: r.to_muxed || null }];
    amount = r.amount ?? null;
    assetKey = assetKeyOf(r);
  } else if (type.startsWith('path_payment')) {
    from = r.from || '';
    recipients = [{ g: r.to || '', m: r.to_muxed || null }];
    amount = r.source_amount ?? null;
    assetKey = assetKeyOf(r, 'source_');
  } else if (type === 'create_account') {
    from = r.funder || r.source_account || '';
    recipients = [{ g: r.account || '', m: null }];
    amount = r.starting_balance ?? null;
  } else if (type === 'account_merge') {
    from = r.account || r.source_account || '';
    recipients = [{ g: r.into || '', m: r.into_muxed || null }];
  } else if (type === 'create_claimable_balance') {
    from = r.source_account || '';
    recipients = (Array.isArray(r.claimants) ? r.claimants : []).map((c) => ({ g: c?.destination || '', m: null }));
    amount = r.amount ?? null;
    assetKey = !r.asset || r.asset === 'native' ? 'native' : String(r.asset);
  }

  const stroops = amount == null ? null : parseStroops(amount);
  const fromMe = from === accountId;
  const toMe = recipients.some((x) => x.g === accountId);
  const dir = fromMe && toMe ? 'self' : fromMe ? 'out' : toMe ? 'in' : '';

  return {
    id: r.id || '',
    created_at: r.created_at || '',
    tx_hash: r.transaction_hash || '',
    type,
    dir,
    from,
    recipients,
    to: recipients.length === 1 ? (recipients[0].m || recipients[0].g) : recipients.map((x) => x.g).join(' '),
    amount: stroops == null ? '' : formatStroops(stroops),
    stroops,
    assetKey,
    memo: '',
  };
}

export function matchesFilters(row, filters) {
  if (filters.memos.length) {
    const memo = cleanMemo(row.memo);
    if (!memo || !filters.memos.some((q) => memo.includes(q))) return false;
  }
  if (filters.notMemos.length) {
    // leeres Memo enthaelt nichts und besteht diesen Filter
    const memo = cleanMemo(row.memo);
    if (memo && filters.notMemos.some((q) => memo.includes(q))) return false;
  }
  if (filters.notExactMemos.length) {
    // Mehrere erwartete Memos sind ODER: Stimmt das Memo genau mit einem ueberein, ist es nicht falsch
    const memo = cleanMemo(row.memo);
    if (filters.notExactMemos.some((q) => memo === q)) return false;
  }
  if (filters.recipients.length) {
    const hit = filters.recipients.some((f) => row.recipients.some((x) => (f.kind === 'M' ? x.m === f.value : x.g === f.value)));
    if (!hit) return false;
  }
  if (filters.amount) {
    const { assetKey, min, max } = filters.amount;
    if (row.stroops == null || row.assetKey !== assetKey) return false;
    if (min !== null && row.stroops < min) return false;
    if (max !== null && row.stroops > max) return false;
  }
  if (filters.direction === 'in' && row.dir !== 'in' && row.dir !== 'self') return false;
  if (filters.direction === 'out' && row.dir !== 'out' && row.dir !== 'self') return false;
  return true;
}

// Summen je Asset (BigInt, exakt). Zeilen ohne Betrag zaehlen nicht mit.
export function sumByAsset(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.stroops == null) continue;
    const cur = map.get(r.assetKey) || { assetKey: r.assetKey, stroops: 0n, count: 0 };
    cur.stroops += r.stroops;
    cur.count += 1;
    map.set(r.assetKey, cur);
  }
  return [...map.values()].map((x) => ({ ...x, amount: formatStroops(x.stroops), label: assetLabel(x.assetKey) }));
}

const throwIfAborted = (signal) => { if (signal?.aborted) throw new Error(SEARCH_ABORT_MESSAGE); };

// withRetry meldet einen Abbruch als withRetry.aborted; das Panel kennt nur SEARCH_ABORT_MESSAGE.
async function retry(fn, signal) {
  try {
    return await withRetry(fn, { signal });
  } catch (e) {
    if (e?.isAborted) throw new Error(SEARCH_ABORT_MESSAGE);
    throw e;
  }
}

// Memos der Transaktionen im Zeitfenster (Hash -> Memo). need (Set) beendet das Laden frueh.
export async function loadTxMemos({ server, accountId, fromISO, toISO, signal, need, maxPages = MAX_PAGES }) {
  const memos = new Map();
  let remaining = need ? new Set(need) : null;
  let page = await retry(() => server.transactions().forAccount(accountId).order('desc').limit(200).call(), signal);
  let pages = 1;
  for (;;) {
    throwIfAborted(signal);
    for (const tx of page?.records || []) {
      const created = tx.created_at || '';
      if (toISO && created >= toISO) continue;
      if (fromISO && created < fromISO) return { memos, incomplete: false };
      memos.set(tx.hash, tx?.memo != null ? String(tx.memo) : '');
      if (remaining) { remaining.delete(tx.hash); if (!remaining.size) return { memos, incomplete: false }; }
    }
    if (!page.next || !(page.records || []).length) return { memos, incomplete: false };
    if (pages >= maxPages) return { memos, incomplete: true };
    page = await retry(() => page.next(), signal);
    pages += 1;
  }
}

// Laedt einmal alle suchbaren Operationen des Kontos im Zeitfenster (neueste zuerst), jeweils mit dem
// Memo der Transaktion. Gefiltert wird danach im Browser mit matchesFilters.
// Ergebnis: { rows, incomplete, memoIncomplete, oldestLoaded, scanned }. incomplete = Ladegrenze erreicht.
export async function loadOperations({ server, accountId, fromISO, toISO, signal, onProgress, maxPages = MAX_PAGES }) {
  const txRes = await loadTxMemos({ server, accountId, fromISO, toISO, signal, maxPages });
  const rows = [];
  let incomplete = false;
  let scanned = 0;
  let oldestLoaded = '';
  let page = await retry(() => server.operations().forAccount(accountId).order('desc').limit(200).call(), signal);
  let pages = 1;
  for (;;) {
    throwIfAborted(signal);
    let reachedStart = false;
    for (const r of page?.records || []) {
      const created = r.created_at || '';
      if (toISO && created >= toISO) continue;
      if (fromISO && created < fromISO) { reachedStart = true; break; }
      scanned += 1;
      oldestLoaded = created;
      const row = normalizeOperation(r, accountId);
      if (!row) continue;
      row.memo = txRes.memos.get(row.tx_hash) ?? '';
      rows.push(row);
    }
    if (reachedStart || !page.next || !(page.records || []).length) break;
    if (pages >= maxPages) { incomplete = true; break; }
    onProgress?.({ phase: 'scan', page: pages, found: rows.length });
    page = await retry(() => page.next(), signal);
    pages += 1;
  }
  // Memos der Transaktionen sind nur in einem Teil des Fensters geladen: Memo-Filter waeren unvollstaendig
  return { rows, incomplete, memoIncomplete: txRes.incomplete, oldestLoaded, scanned };
}

// Sortierung fuer die Anzeige. key: 'created_at' | 'amount'. Zeilen ohne Betrag kommen bei amount ans Ende.
export function sortRows(rows, { key = 'created_at', dir = 'desc' } = {}) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'amount') {
      if (a.stroops == null && b.stroops == null) return 0;
      if (a.stroops == null) return 1;
      if (b.stroops == null) return -1;
      return a.stroops === b.stroops ? 0 : (a.stroops > b.stroops ? 1 : -1) * mul;
    }
    return a.created_at === b.created_at ? 0 : (a.created_at > b.created_at ? 1 : -1) * mul;
  });
}
