// Aufbereitung der Horizon-Payments fuer den Aktivitaetsverlauf (ohne Netzwerkzugriff).
// Sicherheitsrelevant: Memos sind Fremdtext, Gegenparteien koennen Lookalike-Adressen
// sein (Address Poisoning), Kleinstzahlungen werden oft fuer Spam/Phishing genutzt.

/** Eingehende XLM-Zahlungen unter diesem Betrag gelten als Kleinstzahlung (Spam-Verdacht). */
export const DUST_THRESHOLD_XLM = 0.01;

/** Laenge von Anfang/Ende, die fuer den Lookalike-Vergleich herangezogen wird. */
const LOOKALIKE_EDGE = 3;

const MAX_MEMO_LENGTH = 64;

// Unsichtbare oder steuernde Zeichen, mit denen sich Text optisch verfaelschen laesst:
// Cc = Steuerzeichen, Cf = Formatzeichen (Zero-Width, Bidi, Soft Hyphen, TAGS-Block ...),
// Cs = Surrogate, Co = Private Use, Cn = nicht zugewiesen. Dazu einzelne Fuellzeichen,
// die als Buchstaben kategorisiert sind, aber unsichtbar gerendert werden.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u034F\u115F\u1160\u3164\uFFA0]/gu;
// Mehr als zwei kombinierende Zeichen hintereinander (Zalgo) auf zwei begrenzen.
const COMBINING_RUN = /(\p{M}{2})\p{M}+/gu;

// Memo enthaelt etwas, das wie eine Webadresse aussieht (haeufigstes Phishing-Muster).
const URL_LIKE = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|xyz|app|dev|page|finance|exchange|wallet|crypto|link|site|online|info|co|me|top|club|live|cc|to|ly|gift|claim|airdrop|reward|shop|store|pro|vip|win|bid|tk|ml|ga|cf|gq|de|ch|at|eu|us|uk|ru|cn|in|example)(\b|\/))/i;

/**
 * Bereitet ein Text-Memo zur reinen Textanzeige auf: entfernt unsichtbare/steuernde
 * Zeichen, begrenzt kombinierende Zeichen, fasst Leerraum zusammen und kuerzt.
 * Wird nie als HTML oder Link gerendert.
 */
export function sanitizeMemo(value, maxLength = MAX_MEMO_LENGTH) {
  if (value == null) return '';
  const cleaned = String(value)
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_CHARS, '')
    .replace(COMBINING_RUN, '$1')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

/** Enthaelt das Memo etwas, das wie eine Webadresse aussieht? */
export function memoLooksLikeUrl(memo) {
  return URL_LIKE.test(String(memo || ''));
}

/** Transaktions-Hash aus Horizon: nur 64 Hex-Zeichen sind gueltig. */
export function isValidTxHash(hash) {
  return /^[0-9a-f]{64}$/i.test(String(hash || ''));
}

const FAKE_NATIVE_CODES = new Set(['XLM', 'LUMEN', 'LUMENS', 'STELLAR']);

/** Nicht-natives Token, dessen Code wie XLM aussieht (Verwechslungsgefahr). */
export function looksLikeNativeCode(asset) {
  return !!asset && !asset.isNative && FAKE_NATIVE_CODES.has(String(asset.code || '').toUpperCase());
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function assetOf(record) {
  if (!record?.asset_type || record.asset_type === 'native') {
    return { code: 'XLM', issuer: '', isNative: true };
  }
  // Horizon liefert nur [A-Za-z0-9]{1,12}; alles andere wird defensiv entfernt.
  const code = String(record.asset_code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  return { code, issuer: String(record.asset_issuer || ''), isNative: false };
}

function memoOf(record) {
  const tx = record?.transaction || {};
  const type = tx.memo_type || 'none';
  if (type === 'none' || tx.memo == null || tx.memo === '') return { memo: '', memoType: 'none' };
  if (type === 'text') return { memo: sanitizeMemo(tx.memo), memoType: 'text' };
  // id/hash/return: nur als technischer Wert anzeigen
  return { memo: sanitizeMemo(tx.memo, 24), memoType: type };
}

/**
 * Normalisiert einen Datensatz aus /accounts/{id}/payments (mit join=transactions).
 * Liefert null fuer Operationen, die nicht dargestellt werden.
 * @returns {null | { id: string, hash: string, createdAt: string, kind: string, direction: 'in'|'out'|'self',
 *   amount: number|null, asset: {code: string, issuer: string, isNative: boolean}, counterparty: string,
 *   memo: string, memoType: string, successful: boolean }}
 */
export function normalizeActivity(record, publicKey) {
  if (!record || !publicKey) return null;
  const base = {
    id: String(record.id || record.paging_token || ''),
    hash: String(record.transaction_hash || ''),
    createdAt: String(record.created_at || ''),
    successful: record.transaction_successful !== false,
    ...memoOf(record),
  };

  switch (record.type) {
    case 'payment':
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive': {
      const from = String(record.from || '');
      const to = String(record.to || '');
      const direction = from === publicKey && to === publicKey ? 'self' : to === publicKey ? 'in' : 'out';
      return {
        ...base,
        kind: record.type === 'payment' ? 'payment' : 'pathPayment',
        direction,
        amount: num(record.amount),
        asset: assetOf(record),
        counterparty: direction === 'in' ? from : to,
      };
    }
    case 'create_account': {
      const incoming = record.account === publicKey;
      return {
        ...base,
        kind: 'createAccount',
        direction: incoming ? 'in' : 'out',
        amount: num(record.starting_balance),
        asset: { code: 'XLM', issuer: '', isNative: true },
        counterparty: String(incoming ? record.funder || '' : record.account || ''),
      };
    }
    case 'account_merge': {
      const incoming = record.into === publicKey;
      return {
        ...base,
        kind: 'accountMerge',
        direction: incoming ? 'in' : 'out',
        amount: null,
        asset: { code: 'XLM', issuer: '', isNative: true },
        counterparty: String(incoming ? record.account || '' : record.into || ''),
      };
    }
    default:
      return null;
  }
}

/** Filtert auf eine Muxed-Identitaet (nur Datensaetze, die diese M-Adresse betreffen). */
export function matchesMuxed(record, muxedAddress) {
  if (!muxedAddress) return true;
  const fields = [record?.to_muxed, record?.from_muxed, record?.account_muxed, record?.source_account_muxed];
  return fields.some((v) => v && String(v) === String(muxedAddress));
}

/** Eingehende XLM-Kleinstzahlung (typisch fuer Spam/Phishing-Memos und Address Poisoning). */
export function isDust(item) {
  return !!item
    && item.direction === 'in'
    && item.kind !== 'createAccount'
    && item.asset?.isNative
    && item.amount != null
    && item.amount < DUST_THRESHOLD_XLM;
}

/**
 * Markiert eingehende Gegenparteien, die einer Adresse aehneln, an die das Konto
 * selbst gesendet hat (gleicher Anfang und gleiches Ende, aber andere Adresse).
 * Das ist das Muster von Address-Poisoning-Angriffen.
 * @returns {Set<string>} Menge der verdaechtigen Gegenpartei-Adressen
 */
export function findLookalikeCounterparties(items, edge = LOOKALIKE_EDGE) {
  const sentTo = new Set(
    (items || []).filter((i) => i && i.direction === 'out' && i.counterparty).map((i) => i.counterparty)
  );
  const suspicious = new Set();
  if (sentTo.size === 0) return suspicious;
  const key = (a) => `${a.slice(0, edge + 1)}|${a.slice(-edge)}`; // +1: das G/M-Praefix zaehlt nicht
  const sentKeys = new Map();
  sentTo.forEach((addr) => sentKeys.set(key(addr), addr));
  (items || []).forEach((i) => {
    if (!i || i.direction !== 'in' || !i.counterparty || sentTo.has(i.counterparty)) return;
    const match = sentKeys.get(key(i.counterparty));
    if (match && match !== i.counterparty) suspicious.add(i.counterparty);
  });
  return suspicious;
}

/** Nur https-Links zulassen (Explorer-Vorlagen stammen aus Einstellungen/Backups). */
export function safeHttpUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}
