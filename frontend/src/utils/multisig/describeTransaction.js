// Transaktionsweite Angaben fuer das Multisig-Job-Detail (H1): Quellkonto, Sequenz, Memo,
// maximale Fee, Zeitfenster und alle uebrigen Preconditions. Ergaenzt describeOperations,
// das nur die Operationen beschreibt. Signer sehen damit alles, was ihre Signatur
// autorisiert, nicht nur die Operationen.
import { StrKey, SignerKey, extractBaseAddress } from '@stellar/stellar-sdk';
import { formatAmountWithUnit } from '../../components/liquidity/formatPoolAmount.js';
import { MAX_FEE_STROOPS } from '../stellar/fees.js';
import { formatValidUntil } from './formatValidUntil.js';

// Fee-Hervorhebung: SKM bietet nie mehr als MAX_FEE_STROOPS je Operation (0.01 XLM, siehe
// fees.js, auch fuer Jobs mit 'fast'). Liegt das Gebot darueber, hat nicht SKM die Fee
// gesetzt oder jemand hat sie bewusst erhoeht. Die Fee ist ein Hoechstgebot: Ohne Netzlast
// wird nur die Basisgebuehr berechnet, bei Netzlast bis zum Gebot.
export const HIGH_FEE_PER_OP_STROOPS = BigInt(MAX_FEE_STROOPS);

// Preconditions, die SKM selbst nie setzt (per Suche geprueft). Sind sie gesetzt, verlangt
// das Job-Detail vor dem Signieren eine ausdrueckliche Bestaetigung.
export const UNUSUAL_PRECONDITIONS = ['ledgerBounds', 'minAccountSequence', 'minAccountSequenceAge', 'minAccountSequenceLedgerGap', 'extraSigners'];

// Unsichtbare oder irrefuehrende Zeichen im Memo-Text: Steuerzeichen, Format-Zeichen
// (Zero-Width, Bidi, BOM), Zeilen-/Absatztrenner, private und nicht zugewiesene Codepoints,
// alle Leerzeichen ausser U+0020 (NBSP, U+3000 ...), Hangul-Filler, Braille-Blank und
// Variation Selectors. Homoglyphen (z. B. kyrillisches a) sind sichtbar und bleiben, wie sie sind.
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u115F\u1160\u3164\uFFA0\u2800\p{Variation_Selector}]/gu;

function toHex(bytes) {
  return Array.from(bytes || [], (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeInvisible(text) {
  let found = false;
  const escaped = text.replace(INVISIBLE_RE, (ch) => {
    found = true;
    const cp = ch.codePointAt(0);
    return cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  });
  return { escaped, found };
}

function decodeUtf8(bytes) {
  try {
    // ignoreBOM: ein fuehrendes BOM gehoert zum signierten Memo und darf nicht verschwinden.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function formatUnixTime(seconds, locale) {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return String(seconds);
  try {
    return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function toBigInt(value) {
  try {
    return BigInt(String(value ?? '0'));
  } catch {
    return null;
  }
}

// Signed-Payload-Signer (P...): Signer-Konto und Payload lesbar machen.
function describeSignedPayload(strkey) {
  try {
    const raw = StrKey.decodeSignedPayload(strkey);
    const signer = StrKey.encodeEd25519PublicKey(raw.subarray(0, 32));
    const len = new DataView(raw.buffer, raw.byteOffset + 32, 4).getUint32(0);
    return { signer, payload: toHex(raw.subarray(36, 36 + len)) };
  } catch {
    return null;
  }
}

function encodeExtraSigner(signerKey) {
  try {
    return SignerKey.encodeSignerKey(signerKey);
  } catch {
    return null;
  }
}

/**
 * @param {object} tx - stellar-sdk Transaction oder FeeBumpTransaction
 * @param {(key: string, opts?: object) => string} t - an den Namespace 'multisig' gebunden
 * @param {{ locale?: string }} [options]
 * @returns {{
 *   rows: Array<{ key: string, label: string, value: string, wrap?: boolean, emphasis?: boolean, warn?: boolean }>,
 *   warnings: string[],
 *   highFee: boolean,
 *   unusualPreconditions: string[],
 *   feeBump: boolean,
 * }}
 */
export function describeTransaction(tx, t, options = {}) {
  const { locale } = options || {};
  const label = (key, defaultValue, vars = {}) => t(`detail.tx.labels.${key}`, { ...vars, defaultValue });
  const text = (key, defaultValue, vars = {}) => t(`detail.tx.${key}`, { ...vars, defaultValue });
  const rows = [];
  const warnings = [];
  const unusual = [];

  const feeBump = !!tx?.innerTransaction;
  const inner = feeBump ? tx.innerTransaction : tx;
  const ops = Array.isArray(inner?.operations) ? inner.operations : [];

  // Quellkonto und Sequenz
  const source = String(inner?.source || '-');
  rows.push({ key: 'source', label: label('source', 'Quellkonto'), value: source, wrap: true });
  try {
    const base = extractBaseAddress(source);
    if (base && base !== source) rows.push({ key: 'sourceBase', label: label('sourceBase', 'Basiskonto'), value: base, wrap: true });
  } catch { /* Quelle bleibt wie angezeigt */ }
  rows.push({ key: 'sequence', label: label('sequence', 'Sequence'), value: String(inner?.sequence ?? '-'), wrap: true });

  // Memo
  let memo = null;
  try {
    memo = inner?.memo || null;
  } catch {
    memo = null;
  }
  const memoType = memo?.type || 'none';
  const typeLabel = {
    none: text('memoTypes.none', 'Kein Memo'),
    text: text('memoTypes.text', 'Text'),
    id: text('memoTypes.id', 'ID'),
    hash: text('memoTypes.hash', 'Hash'),
    return: text('memoTypes.return', 'Return'),
  }[memoType] || memoType;
  rows.push({ key: 'memoType', label: label('memoType', 'Memo Typ'), value: typeLabel, emphasis: memoType !== 'none' });
  if (memoType === 'text') {
    const value = memo.value;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value || []);
    const decoded = decodeUtf8(bytes);
    if (decoded === null) {
      rows.push({ key: 'memo', label: label('memoHex', 'Memo (Hex)'), value: toHex(bytes), wrap: true, warn: true });
      warnings.push(text('warnMemoNotUtf8', 'Das Text-Memo ist kein gültiges UTF-8 und wird deshalb als Hex angezeigt.'));
    } else {
      const { escaped, found } = escapeInvisible(decoded);
      // Anfuehrungszeichen machen Leerzeichen am Rand sichtbar.
      rows.push({ key: 'memo', label: label('memo', 'Memo'), value: `"${escaped}"`, emphasis: true, warn: found });
      if (found) warnings.push(text('warnMemoInvisible', 'Das Memo enthält unsichtbare oder leicht verwechselbare Zeichen (z. B. Steuer-, Zero-Width- oder Bidi-Zeichen, besondere Leerzeichen). Sie sind als \\u… dargestellt. Prüfe das Memo genau.'));
      if (decoded !== decoded.trim()) warnings.push(text('warnMemoWhitespace', 'Das Memo beginnt oder endet mit einem Leerzeichen.'));
    }
  } else if (memoType === 'id') {
    rows.push({ key: 'memo', label: label('memo', 'Memo'), value: String(memo.value), emphasis: true, wrap: true });
  } else if (memoType === 'hash' || memoType === 'return') {
    rows.push({ key: 'memo', label: label('memoHex', 'Memo (Hex)'), value: toHex(memo.value), emphasis: true, wrap: true });
  }

  // Maximale Fee
  const innerFee = toBigInt(inner?.fee);
  const opCount = BigInt(Math.max(ops.length, 1));
  let highFee = false;
  if (innerFee !== null) {
    rows.push({ key: 'fee', label: label('fee', 'Maximale Fee'), value: formatAmountWithUnit(innerFee, 'XLM', locale), emphasis: true });
    rows.push({ key: 'feePerOp', label: label('feePerOp', 'Maximale Fee je Operation'), value: formatAmountWithUnit(innerFee / opCount, 'XLM', locale) });
    highFee = innerFee > HIGH_FEE_PER_OP_STROOPS * opCount;
  }
  if (feeBump) {
    const outerFee = toBigInt(tx.fee);
    rows.push({ key: 'feeBumpSource', label: label('feeBumpSource', 'Fee-Bump: zahlendes Konto'), value: String(tx.feeSource || '-'), wrap: true });
    if (outerFee !== null) {
      rows.push({ key: 'feeBumpFee', label: label('feeBumpFee', 'Fee-Bump: maximale Fee'), value: formatAmountWithUnit(outerFee, 'XLM', locale), emphasis: true });
      const outerOps = opCount + 1n;
      highFee = highFee || outerFee > HIGH_FEE_PER_OP_STROOPS * outerOps;
    }
  }
  if (highFee) {
    rows.filter((r) => r.key === 'fee' || r.key === 'feeBumpFee').forEach((r) => { r.warn = true; });
    warnings.push(text(
      'warnHighFee',
      'Die Fee liegt über dem, was SKM selbst bietet (höchstens {{max}} je Operation). Sie ist ein Höchstgebot: Bei Netzlast kann sie bis zu diesem Betrag kosten.',
      { max: formatAmountWithUnit(HIGH_FEE_PER_OP_STROOPS, 'XLM', locale) },
    ));
  }

  // Zeitfenster
  const minTime = String(inner?.timeBounds?.minTime ?? '0');
  const maxTime = String(inner?.timeBounds?.maxTime ?? '0');
  rows.push({
    key: 'validFrom',
    label: label('validFrom', 'Gültig ab'),
    value: minTime === '0' ? text('validFromNow', 'sofort') : formatUnixTime(minTime, locale),
  });
  rows.push({ key: 'validUntil', label: t('detail.validUntil.label', { defaultValue: 'Gültig bis' }), value: formatValidUntil(maxTime, locale, t) });

  // Weitere Preconditions, nur wenn gesetzt
  const lb = inner?.ledgerBounds;
  if (lb && (Number(lb.minLedger) > 0 || Number(lb.maxLedger) > 0)) {
    unusual.push('ledgerBounds');
    rows.push({ key: 'minLedger', label: label('minLedger', 'Frühestes Ledger'), value: Number(lb.minLedger) > 0 ? String(lb.minLedger) : '-', warn: true });
    rows.push({ key: 'maxLedger', label: label('maxLedger', 'Letztes Ledger'), value: Number(lb.maxLedger) > 0 ? String(lb.maxLedger) : text('unbounded', 'unbegrenzt'), warn: true });
  }
  if (inner?.minAccountSequence !== undefined && inner?.minAccountSequence !== null) {
    unusual.push('minAccountSequence');
    rows.push({ key: 'minAccountSequence', label: label('minAccountSequence', 'Min. Account Sequence'), value: String(inner.minAccountSequence), wrap: true, warn: true });
  }
  const seqAge = toBigInt(inner?.minAccountSequenceAge);
  if (seqAge !== null && seqAge > 0n) {
    unusual.push('minAccountSequenceAge');
    rows.push({ key: 'minAccountSequenceAge', label: label('minAccountSequenceAge', 'Min. Alter der Sequence'), value: text('seconds', '{{value}} Sekunden', { value: String(seqAge) }), warn: true });
  }
  const ledgerGap = Number(inner?.minAccountSequenceLedgerGap || 0);
  if (ledgerGap > 0) {
    unusual.push('minAccountSequenceLedgerGap');
    rows.push({ key: 'minAccountSequenceLedgerGap', label: label('minAccountSequenceLedgerGap', 'Min. Ledger-Abstand zur Sequence'), value: String(ledgerGap), warn: true });
  }
  const extraSigners = Array.isArray(inner?.extraSigners) ? inner.extraSigners : [];
  if (extraSigners.length) {
    unusual.push('extraSigners');
    extraSigners.forEach((signerKey, index) => {
      const n = index + 1;
      const encoded = encodeExtraSigner(signerKey);
      rows.push({ key: `extraSigner${n}`, label: label('extraSigner', 'Extra Signer {{n}}', { n }), value: encoded || text('unreadable', 'nicht lesbar'), wrap: true, warn: true });
      if (encoded && encoded.startsWith('P')) {
        const parts = describeSignedPayload(encoded);
        if (parts) {
          rows.push({ key: `extraSigner${n}Account`, label: label('extraSignerAccount', 'Extra Signer {{n}}: Konto', { n }), value: parts.signer, wrap: true, warn: true });
          rows.push({ key: `extraSigner${n}Payload`, label: label('extraSignerPayload', 'Extra Signer {{n}}: Payload (Hex)', { n }), value: parts.payload || '-', wrap: true, warn: true });
        }
      }
    });
  }

  return { rows, warnings, highFee, unusualPreconditions: unusual, feeBump };
}
