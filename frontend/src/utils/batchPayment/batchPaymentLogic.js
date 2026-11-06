// Pruefen und Bauen der Zahlungen einer Sammelzahlung.
//
// Jede Zeile wird eine eigene Transaktion mit genau einer Payment-Operation, weil Stellar
// nur ein Memo pro Transaktion kennt. Die Pruefungen entsprechen den harten Sperren von
// "Zahlung senden" (Trustline, SEP-29 memo_required, Federation-Memo) - hier ohne
// "trotzdem senden": Eine Abweichung blockiert die Zeile.
//
// Bewusst nicht unterstuetzt (Zeile wird blockiert, Hinweis auf "Zahlung senden"):
// - Multisig-Konten als Sender (Sammelzahlung signiert nur mit dem Master Key des Senders)
// - nicht aktivierte Empfaenger (Aktivierung per createAccount nur ueber "Zahlung senden")
import { Account, Asset, Keypair, Memo, MuxedAccount, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { resolveOrValidateAccount } from '../stellar/stellarUtils.js';
import { accountRequiresMemo } from '../stellar/memoRequired.js';
import { containsSecretKey, normalizeAmount } from './batchPaymentStore.js';

export const BATCH_SUBMIT_TIMEOUT_SECONDS = 180;
const STROOPS_PER_XLM = 10_000_000n;

// Dezimal-String (Horizon oder normalisierter Betrag) exakt in Stroops, ohne Fliesskomma.
// Fehlender Wert (undefined, leer) gilt als 0, ein ungueltiger Text wirft (nie fail-open).
export function toStroops(amount) {
  if (amount === undefined || amount === null || amount === '') return 0n;
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('invalidAmount');
  const [i, f = ''] = s.split('.');
  return BigInt(i) * STROOPS_PER_XLM + BigInt((f + '0000000').slice(0, 7));
}

function fromStroops(stroops) {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const i = v / STROOPS_PER_XLM;
  const f = (v % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${f ? `.${f}` : ''}`;
}

// Anzeige eines Assets mit gekuerztem Aussteller, damit gleiche Codes unterscheidbar sind.
export function assetDisplay(assetKey) {
  const a = parseAssetKey(assetKey);
  if (!a) return String(assetKey || '');
  if (a.native) return 'XLM';
  return `${a.code} (${a.issuer.slice(0, 8)}…${a.issuer.slice(-8)})`;
}

export function parseAssetKey(assetKey) {
  if (!assetKey || assetKey === 'XLM') return { native: true, code: 'XLM', issuer: '' };
  const [code, issuer] = String(assetKey).split(':');
  if (!code || !/^[A-Za-z0-9]{1,12}$/.test(code) || !StrKey.isValidEd25519PublicKey(issuer || '')) return null;
  return { native: false, code, issuer };
}

export function buildMemo(memoType, memoVal) {
  const value = String(memoVal || '').trim();
  if (!value || memoType === 'none') return undefined;
  switch (memoType) {
    case 'text': return Memo.text(value);
    case 'id': return Memo.id(value);
    case 'hash':
    case 'return': {
      const hex = value.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('memoInvalid');
      const buf = Buffer.from(hex, 'hex');
      return memoType === 'hash' ? Memo.hash(buf) : Memo.return(buf);
    }
    default: return undefined;
  }
}

// SEP-2: memo_type/memo vom Federation-Server in die Form-Darstellung (hash: base64 -> hex).
function federationMemoToLocal(memoType, memoValue) {
  if (typeof memoValue !== 'string' || !memoValue) return null;
  if (memoType === 'text' || memoType === 'id') return { memoType, memoVal: memoValue };
  if (memoType === 'hash') {
    const hex = Buffer.from(memoValue, 'base64').toString('hex');
    return /^[0-9a-f]{64}$/.test(hex) ? { memoType: 'hash', memoVal: hex } : null;
  }
  return null;
}

function memoMatches(memoType, memoVal, expectedType, expectedVal) {
  const t = memoType === 'none' || !String(memoVal || '').trim() ? 'none' : memoType;
  if (t !== expectedType) return false;
  let a = String(memoVal || '').trim();
  let b = String(expectedVal || '').trim();
  if (t === 'hash') { a = a.replace(/^0x/i, '').toLowerCase(); b = b.toLowerCase(); }
  return a === b;
}

// Reine Eingabepruefung ohne Netzwerk. Liefert einen Fehlercode oder null.
export function validateRowInput(row) {
  // Nie mit einem eingefuegten Secret weiterarbeiten: keine Federation- oder Horizon-Abfrage.
  if (['source', 'dest', 'amount', 'memoVal', 'assetKey'].some((f) => containsSecretKey(row[f]))) return 'containsSecret';
  const source = String(row.source || '').trim();
  if (!source) return 'sourceMissing';
  if (!StrKey.isValidEd25519PublicKey(source)) return 'sourceInvalid';
  if (!String(row.dest || '').trim()) return 'destMissing';
  const asset = parseAssetKey(row.assetKey);
  if (!asset) return 'assetInvalid';
  // Nachgemachtes XLM (Code XLM mit Aussteller) sieht aus wie das native Asset.
  if (!asset.native && asset.code.toUpperCase() === 'XLM') return 'assetFakeXlm';
  if (!normalizeAmount(row.amount)) return 'amountInvalid';
  try {
    buildMemo(row.memoType, row.memoVal);
  } catch {
    return 'memoInvalid';
  }
  return null;
}

// Kann das Sender-Konto allein mit seinem Master Key eine Zahlung signieren?
export function checkSourceAccount(account) {
  if (!account) return 'sourceNotFound';
  const signers = Array.isArray(account.signers) ? account.signers : [];
  const id = account.account_id || account.id || (typeof account.accountId === 'function' ? account.accountId() : '');
  const master = signers.find((s) => s?.key === id);
  const masterWeight = Number(master?.weight || 0);
  const med = Number(account.thresholds?.med_threshold ?? 0);
  const otherSigners = signers.filter((s) => s?.key !== id && Number(s?.weight || 0) > 0);
  if (masterWeight <= 0 || masterWeight < med || otherSigners.length > 0) return 'sourceMultisig';
  return null;
}

/**
 * Prueft eine Zeile gegen das Netz. Gibt { code, params, destination } zurueck;
 * code === null bedeutet "bereit".
 */
export async function checkRowOnNetwork({ server, row }) {
  let resolved;
  try {
    resolved = await resolveOrValidateAccount(String(row.dest).trim());
  } catch {
    return { code: 'destInvalid' };
  }
  const destination = resolved.muxedAddress || resolved.accountId;
  if (resolved.accountId === String(row.source).trim()) return { code: 'sameAccount' };

  if (resolved.memo != null && resolved.memoType) {
    const expected = federationMemoToLocal(resolved.memoType, resolved.memo);
    if (!expected) return { code: 'federationMemoUnsupported' };
    if (!memoMatches(row.memoType, row.memoVal, expected.memoType, expected.memoVal)) {
      return { code: 'federationMemoMismatch', params: { memo: expected.memoVal } };
    }
  }

  let destAccount;
  try {
    destAccount = await server.loadAccount(resolved.accountId);
  } catch (e) {
    if (e?.response?.status === 404) return { code: 'destUnfunded' };
    return { code: 'destLoadFailed' };
  }

  const asset = parseAssetKey(row.assetKey);
  if (!asset.native && resolved.accountId !== asset.issuer) {
    const line = (destAccount.balances || []).find(
      (b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer
    );
    if (!line) return { code: 'noTrustline', params: { asset: asset.code } };
    if (line.is_authorized === false) return { code: 'notAuthorized', params: { asset: asset.code } };
  }

  if (!resolved.muxedAddress && !buildMemo(row.memoType, row.memoVal) && accountRequiresMemo(destAccount)) {
    return { code: 'memoRequired' };
  }

  const federation = String(row.dest).includes('*') ? String(row.dest).trim() : '';
  return { code: null, destination, accountId: resolved.accountId, federation };
}

// Memo in kanonischer Form, so wie es in der Transaktion steht.
function canonicalMemo(memoType, memoVal) {
  const value = String(memoVal || '').trim();
  if (!value || memoType === 'none') return ['none', ''];
  if (memoType === 'id') {
    try { return ['id', BigInt(value).toString()]; } catch { return ['id', value]; }
  }
  if (memoType === 'hash' || memoType === 'return') return [memoType, value.replace(/^0x/i, '').toLowerCase()];
  return ['text', value];
}

/**
 * Grober Schluessel fuer Zahlungen an Boersen-Konten: Basis-G-Konto plus Routing-ID
 * (Muxed-ID der M-Adresse oder Memo ID). "M..." und "G... mit Memo ID N" ergeben denselben
 * Schluessel. null, wenn keine Routing-ID vorhanden ist. Nur fuer eine Warnung.
 */
export function routingFingerprint({ network, row, destination }) {
  const dest = String(destination || '').trim();
  let base;
  let id;
  let memo;
  if (StrKey.isValidMed25519PublicKey(dest)) {
    const muxed = MuxedAccount.fromAddress(dest, '0');
    base = muxed.baseAccount().accountId();
    id = muxed.id();
    // Ein zusaetzliches Memo an die M-Adresse macht es zu einer anderen Zahlung
    // (z.B. zwei Monatsraten mit gleichem Betrag, aber anderem Memo-Text).
    memo = canonicalMemo(row.memoType, row.memoVal);
  } else if (row.memoType === 'id' && String(row.memoVal || '').trim()) {
    base = dest;
    try { id = BigInt(String(row.memoVal).trim()).toString(); } catch { return null; }
    memo = ['none', ''];
  } else {
    return null;
  }
  return JSON.stringify(['route', network, String(row.source || '').trim(), base,
    String(row.assetKey || 'XLM').trim(), normalizeAmount(row.amount) || '', id, ...memo]);
}

/**
 * Fingerprint einer Zahlung aus dem tatsaechlichen Transaktionsinhalt: Netz, Sender,
 * aufgeloestes Ziel (G- oder M-Adresse, nicht die Eingabe), Asset, Betrag, Memo.
 * name*domain und die G-Adresse dahinter ergeben denselben Fingerprint.
 */
export function paymentFingerprint({ network, row, destination }) {
  return JSON.stringify([
    network,
    String(row.source || '').trim(),
    String(destination || '').trim(),
    String(row.assetKey || 'XLM').trim(),
    normalizeAmount(row.amount) || '',
    ...canonicalMemo(row.memoType, row.memoVal),
  ]);
}

// Sicherheitsabstand zwischen maxTime und dem letzten bekannten Ledger, falls Horizon
// hinter einem Load-Balancer laeuft und die Knoten unterschiedlich weit sind.
export const AMBIGUOUS_LEDGER_BUFFER_SECONDS = 60;

/**
 * Zeitpunkt (ms, lokale Uhr), ab dem resolveAmbiguous fruehestens 'expired' liefern kann:
 * maxTime der Transaktion plus Puffer. Massgeblich bleibt der Ledger-Zeitstempel von
 * Horizon; die Angabe ist fuer die Anzeige und die automatische Pruefung. null ohne maxTime.
 */
export function ambiguousClearAt(entry) {
  const maxTime = Number(entry?.maxTime);
  return Number.isInteger(maxTime) && maxTime > 0 ? (maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS) * 1000 : null;
}

// Mindestabstand der zwei Abfragen, bevor ein Eintrag mit verbrauchter (oder unbekannter)
// Sequence als abgelaufen gilt. Ein hinkender Horizon-Knoten oder ein Cache soll den
// Hash nicht zweimal kurz hintereinander als "nicht gefunden" melden koennen.
export const AMBIGUOUS_STRICT_RECHECK_MS = 30 * 1000;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Sequence eines Kontos (AccountResponse oder Account des SDK) als BigInt oder null.
export function accountSequenceOf(account) {
  try {
    const raw = typeof account?.sequenceNumber === 'function' ? account.sequenceNumber() : account?.sequence;
    return /^\d+$/.test(String(raw ?? '')) ? BigInt(String(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Sucht einen Hash bei Horizon. Ein Treffer zaehlt nur, wenn der Hash der Antwort dem
 * gesuchten entspricht: 'success' (successful true), 'failed' (successful false),
 * 'notFound' (404) oder 'unknown' (Netzfehler, anderer Status, Antwort ohne passenden Hash
 * oder ohne eindeutiges successful).
 */
export async function lookupTransaction(server, hash) {
  try {
    const record = await server.transactions().transaction(hash).call();
    if (String(record?.hash || '').toLowerCase() !== String(hash || '').toLowerCase()) return 'unknown';
    if (record.successful === true) return 'success';
    if (record.successful === false) return 'failed';
    return 'unknown';
  } catch (e) {
    return e?.response?.status === 404 ? 'notFound' : 'unknown';
  }
}

// Alle Hashes eines Eintrags (aktueller zuerst, dann fruehere Versuche).
function entryHashes(entry) {
  return [entry.hash, ...(Array.isArray(entry.prev) ? entry.prev : [])].filter(Boolean);
}

/**
 * Sucht alle Hashes eines Eintrags: { result, hash }. Erfolgreich gefunden gewinnt; sonst
 * 'unknown', wenn eine Abfrage nicht eindeutig war; sonst 'failed' fuer den aktuellen Hash;
 * sonst 'notFound'. Eine fruehere, fehlgeschlagene Transaktion entscheidet nichts.
 */
async function lookupEntry(server, entry) {
  let unknown = false;
  let failed = false;
  for (const hash of entryHashes(entry)) {
    const r = await lookupTransaction(server, hash);
    if (r === 'success') return { result: 'success', hash };
    if (r === 'unknown') unknown = true;
    if (r === 'failed' && hash === entry.hash) failed = true;
  }
  if (unknown) return { result: 'unknown', hash: entry.hash };
  if (failed) return { result: 'failed', hash: entry.hash };
  return { result: 'notFound', hash: entry.hash };
}

async function latestClosedSeconds(server) {
  try {
    const ledgers = await server.ledgers().order('desc').limit(1).call();
    return Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
  } catch {
    return NaN;
  }
}

/**
 * Loest einen unklaren Eintrag ueber Horizon auf. Ergebnis { outcome, hash }:
 * - 'success' (im Ledger erfolgreich; hash = gefundener Hash, auch ein frueherer Versuch)
 * - 'failed' (im Ledger fehlgeschlagen)
 * - 'expiredPinned' (nicht im Ledger, abgelaufen, die Sequence ist laut Horizon noch frei:
 *   erneut senden nur mit genau dieser Sequence, dann kann das Netz hoechstens eine der
 *   beiden Transaktionen ausfuehren, auch wenn Horizon hinkt)
 * - 'expired' (nicht im Ledger, abgelaufen, Sequence verbraucht oder unbekannt: nur nach
 *   zwei Abfragen im Abstand von mindestens AMBIGUOUS_STRICT_RECHECK_MS, die beide den Hash
 *   nicht finden und beide einen Ledger nach maxTime plus Puffer melden)
 * - 'pending' (nicht im Ledger, laut letztem Ledger noch gueltig oder im Puffer)
 * - 'unknown' (Horizon nicht erreichbar oder nicht eindeutig, Eintrag ohne maxTime
 *   (auch maxTime <= 0) oder unlesbar)
 *
 * "Abgelaufen" haengt nicht an der Client-Uhr, sondern an closed_at des letzten Ledgers.
 */
export async function resolveAmbiguousDetailed({
  server, entry, retryDelayMs = 2000, strictDelayMs = AMBIGUOUS_STRICT_RECHECK_MS, sleep = sleepMs,
}) {
  if (!entry?.hash || entry.unreadable) return { outcome: 'unknown', hash: entry?.hash || '' };
  const maxTime = Number(entry.maxTime);
  const hasMaxTime = Number.isInteger(maxTime) && maxTime > 0;
  const pastValidity = (closed) => Number.isFinite(closed) && closed > maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
  const found = (r) => ({ outcome: r.result, hash: r.hash });

  if (!hasMaxTime) {
    const r = await lookupEntry(server, entry);
    return r.result === 'notFound' ? { outcome: 'unknown', hash: entry.hash } : found(r);
  }

  const closed1 = await latestClosedSeconds(server);
  let r = await lookupEntry(server, entry);
  if (r.result !== 'notFound') return found(r);
  if (!pastValidity(closed1)) return { outcome: Number.isFinite(closed1) ? 'pending' : 'unknown', hash: entry.hash };

  // Ist die Sequence der Transaktion noch frei? Dann ist sie nicht angewendet worden
  // (oder Horizon hinkt). Eine neue Transaktion mit derselben Sequence schliesst eine
  // Doppelzahlung in beiden Faellen aus.
  if (entry.seq && entry.source) {
    let accountSeq = null;
    try {
      accountSeq = accountSequenceOf(await server.loadAccount(entry.source));
    } catch (e) {
      if (e?.response?.status !== 404) return { outcome: 'unknown', hash: entry.hash };
    }
    if (accountSeq !== null && accountSeq < BigInt(entry.seq)) {
      await sleep(retryDelayMs);
      r = await lookupEntry(server, entry);
      return r.result === 'notFound' ? { outcome: 'expiredPinned', hash: entry.hash } : found(r);
    }
  }

  // Sequence verbraucht (andere Zahlungen dieses Kontos seitdem, oder die Transaktion
  // selbst) oder unbekannt: nur nach einer zweiten Abfrage mit Abstand.
  await sleep(strictDelayMs);
  r = await lookupEntry(server, entry);
  if (r.result !== 'notFound') return found(r);
  const closed2 = await latestClosedSeconds(server);
  if (!pastValidity(closed2)) return { outcome: Number.isFinite(closed2) ? 'pending' : 'unknown', hash: entry.hash };
  return { outcome: 'expired', hash: entry.hash };
}

/** Wie resolveAmbiguousDetailed, liefert nur das Ergebnis (String). */
export async function resolveAmbiguous(args) {
  return (await resolveAmbiguousDetailed(args)).outcome;
}

/**
 * Konto fuer eine neue Transaktion einer zuvor unklaren Zahlung mit Pin: Ist die aktuelle
 * Sequence des Kontos kleiner als die gespeicherte, bekommt die neue Transaktion genau
 * diese Sequence (Account mit Sequence minus 1). { account, pinned } oder
 * { consumed: true }, wenn die Sequence schon erreicht oder ueberschritten ist.
 */
export function pinnedSendAccount({ account, source, pinSeq }) {
  const current = accountSequenceOf(account);
  const pin = BigInt(pinSeq);
  if (current === null || current >= pin) return { consumed: true };
  return { account: new Account(String(source).trim(), (pin - 1n).toString()), pinned: true };
}

/** Hat das Netz die Transaktion wegen der Sequence abgelehnt (tx_bad_seq)? */
export function isBadSeqError(err) {
  return err?.response?.data?.extras?.result_codes?.transaction === 'tx_bad_seq';
}

/**
 * Sucht mehrere Hashes (fruehere Versuche einer Zahlung) einige Male. 'success' mit dem
 * gefundenen Hash, sonst 'notFound' oder 'unknown'.
 */
export async function findAnyTransaction({ server, hashes, attempts = 3, delayMs = 1500, sleep = sleepMs }) {
  let last = 'notFound';
  for (let i = 0; i < attempts; i += 1) {
    last = 'notFound';
    for (const hash of hashes) {
      const r = await lookupTransaction(server, hash);
      if (r === 'success') return { result: 'success', hash };
      if (r === 'unknown') last = 'unknown';
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { result: last, hash: '' };
}

// Memo eines Horizon-Transaktionsdatensatzes in kanonischer Form (wie canonicalMemo).
function horizonMemo(txRecord) {
  const type = String(txRecord?.memo_type || 'none');
  const value = txRecord?.memo;
  if (type === 'none' || value === undefined || value === null || value === '') return ['none', ''];
  if (type === 'hash' || type === 'return') return [type, Buffer.from(String(value), 'base64').toString('hex')];
  if (type === 'id') return ['id', String(value)];
  return ['text', String(value)];
}

// Passt ein Payment-Datensatz (mit join=transactions) genau zu dieser Zahlung?
function paymentMatches(record, { source, destination, assetKey, amount, memo }) {
  if (record?.type !== 'payment' || record.transaction_successful === false) return false;
  if (record.from !== source) return false;
  const dest = String(destination || '').trim();
  if (StrKey.isValidMed25519PublicKey(dest)) {
    if (record.to_muxed !== dest) return false;
  } else if (record.to !== dest || record.to_muxed) {
    return false;
  }
  const asset = parseAssetKey(assetKey);
  if (asset.native) {
    if (record.asset_type !== 'native') return false;
  } else if (record.asset_code !== asset.code || record.asset_issuer !== asset.issuer) {
    return false;
  }
  if (normalizeAmount(record.amount) !== amount) return false;
  const tx = record.transaction_attr;
  if (!tx || typeof tx !== 'object') return false;
  const m = horizonMemo(tx);
  return m[0] === memo[0] && m[1] === memo[1];
}

export const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sucht bei Horizon unter den Zahlungen des Quellkontos (neueste zuerst) eine mit genau
 * diesem Ziel, Asset, Betrag und Memo innerhalb von windowMs vor nowMs.
 * { status: 'found', hash, at } | { status: 'none' } | { status: 'unreachable' }
 * (auch, wenn nach maxPages Seiten das Zeitfenster noch nicht zu Ende ist).
 */
export async function findRecentMatchingPayment({
  server, row, destination, nowMs = Date.now(), windowMs = HISTORY_WINDOW_MS, pageLimit = 200, maxPages = 5,
}) {
  const source = String(row.source || '').trim();
  const want = {
    source,
    destination,
    assetKey: row.assetKey,
    amount: normalizeAmount(row.amount),
    memo: canonicalMemo(row.memoType, row.memoVal),
  };
  const since = nowMs - windowMs;
  try {
    let page = await server.payments().forAccount(source).order('desc').limit(pageLimit).join('transactions').call();
    for (let p = 0; p < maxPages; p += 1) {
      const records = page?.records || [];
      for (const rec of records) {
        const at = Date.parse(rec?.created_at);
        if (!Number.isFinite(at)) return { status: 'unreachable' };
        if (at < since) return { status: 'none' };
        if (paymentMatches(rec, want)) return { status: 'found', hash: String(rec.transaction_hash || '').toLowerCase(), at };
      }
      if (records.length < pageLimit) return { status: 'none' };
      if (p === maxPages - 1) break;
      page = await page.next();
    }
    return { status: 'unreachable' };
  } catch (e) {
    // Konto ohne Zahlungen bzw. unbekannt: nichts gesendet.
    if (e?.response?.status === 404) return { status: 'none' };
    return { status: 'unreachable' };
  }
}

/**
 * Summen pro Sender gegen das verfuegbare Guthaben, exakt in Stroops.
 * rows: nur die zum Senden gewaehlten. baseReserveStroops: BigInt.
 * Verfuegbar XLM = Guthaben - (2 + Subentries + Sponsoring - Sponsored) * Base Reserve
 * - Verkaufsverbindlichkeiten. Der Aussteller eines Assets hat davon unbegrenzt.
 */
export function computeSourceTotals({ rows, accounts, baseReserveStroops = 5000000n, feeStroops }) {
  const result = new Map();
  for (const row of rows) {
    const source = String(row.source).trim();
    const account = accounts.get(source);
    if (!result.has(source)) {
      let available = 0n;
      if (account) {
        const native = (account.balances || []).find((b) => b.asset_type === 'native');
        const entries = 2n + BigInt(Number(account.subentry_count) || 0)
          + BigInt(Number(account.num_sponsoring) || 0) - BigInt(Number(account.num_sponsored) || 0);
        available = toStroops(native?.balance) - (entries > 0n ? entries : 0n) * baseReserveStroops
          - toStroops(native?.selling_liabilities);
        if (available < 0n) available = 0n;
      }
      result.set(source, { xlmNeededStroops: 0n, xlmAvailableStroops: available, assets: new Map() });
    }
    const entry = result.get(source);
    entry.xlmNeededStroops += BigInt(feeStroops || 100);
    const asset = parseAssetKey(row.assetKey);
    const amount = toStroops(normalizeAmount(row.amount));
    if (asset.native) {
      entry.xlmNeededStroops += amount;
    } else {
      const key = `${asset.code}:${asset.issuer}`;
      if (!entry.assets.has(key)) {
        const isIssuer = asset.issuer === source;
        const line = (account?.balances || []).find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer);
        const available = line ? toStroops(line.balance) - toStroops(line.selling_liabilities) : 0n;
        entry.assets.set(key, { key, code: asset.code, neededStroops: 0n, availableStroops: available, hasLine: !!line, isIssuer });
      }
      entry.assets.get(key).neededStroops += amount;
    }
  }
  const out = new Map();
  for (const [source, e] of result) {
    const assets = [...e.assets.values()].map((a) => ({
      key: a.key,
      code: a.code,
      needed: fromStroops(a.neededStroops),
      available: a.isIssuer ? null : fromStroops(a.availableStroops),
      ok: a.isIssuer || (a.hasLine && a.neededStroops <= a.availableStroops),
    }));
    const xlmOk = e.xlmNeededStroops <= e.xlmAvailableStroops;
    out.set(source, {
      xlmNeeded: fromStroops(e.xlmNeededStroops),
      xlmAvailable: fromStroops(e.xlmAvailableStroops),
      xlmOk,
      assets,
      ok: xlmOk && assets.every((a) => a.ok),
    });
  }
  return out;
}

/** Baut und signiert die Transaktion einer Zeile. keypair muss der Master Key des Senders sein. */
export function buildSignedRowTx({ account, row, destination, fee, networkPassphrase, keypair }) {
  if (!(keypair instanceof Keypair) || keypair.publicKey() !== String(row.source).trim()) {
    throw new Error('keyMismatch');
  }
  const asset = parseAssetKey(row.assetKey);
  const tx = new TransactionBuilder(account, { fee: String(fee), networkPassphrase, memo: buildMemo(row.memoType, row.memoVal) })
    .addOperation(Operation.payment({
      destination,
      amount: normalizeAmount(row.amount),
      asset: asset.native ? Asset.native() : new Asset(asset.code, asset.issuer),
    }))
    .setTimeout(BATCH_SUBMIT_TIMEOUT_SECONDS)
    .build();
  tx.sign(keypair);
  return tx;
}

// Kurzbeschreibung eines Horizon-Fehlers (result_codes), sonst die Fehlermeldung.
export function describeSubmitError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (codes) {
    const ops = Array.isArray(codes.operations) ? codes.operations.filter((c) => c && c !== 'op_success') : [];
    return [codes.transaction, ...ops].filter(Boolean).join(' / ');
  }
  return String(err?.message || err || '');
}
