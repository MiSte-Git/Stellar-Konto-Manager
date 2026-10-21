// SEP-7 Zahlungsanfragen (Backlog P2.1): web+stellar:pay?destination=...&amount=...
// Bauen fuer die Empfangen-Seite, Lesen fuer den QR-Scan beim Senden.
//
// Sicherheit: Eine gescannte Anfrage fuellt nur das Formular vor. Alle Pruefungen beim Senden
// (Trustline, Pflicht-Memo, Bestaetigung) laufen danach wie bei manueller Eingabe.
// origin_domain und signature werden nicht geprueft (das waere ein Abruf fremder Domains,
// den die CSP verhindert) und nur neutral als "nicht geprueft" angezeigt. callback wird nie
// aufgerufen. web+stellar:tx (fremde Transaktion signieren) wird bewusst nicht unterstuetzt.
import { Buffer } from 'buffer';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { isContractAddress } from './addressType.js';

const AMOUNT_RE = /^\d+(?:\.\d{1,7})?$/;
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const MEMO_ID_RE = /^\d{1,20}$/;
const FEDERATION_RE = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;
const MAX_MSG_LENGTH = 300;
const UINT64_MAX = 18446744073709551615n;

function isAccount(v) {
  return StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v);
}

function textBytes(v) {
  return new TextEncoder().encode(v).length;
}

// Werte sind prozent-kodiert. URLSearchParams wuerde ein "+" als Leerzeichen lesen und damit
// base64-Memos beschaedigen, deshalb von Hand zerlegen.
function parseQuery(query) {
  const params = new Map();
  for (const part of String(query || '').split('&')) {
    if (!part) continue;
    const idx = part.indexOf('=');
    const key = idx >= 0 ? part.slice(0, idx) : part;
    const raw = idx >= 0 ? part.slice(idx + 1) : '';
    let value;
    try {
      value = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (params.has(key)) return null; // doppelte Parameter: mehrdeutig, ablehnen
    params.set(key, value);
  }
  return params;
}

function memoFromSep7(memo, memoType) {
  const type = (memoType || 'MEMO_TEXT').toUpperCase();
  if (type === 'MEMO_TEXT') {
    return textBytes(memo) <= 28 ? { type: 'text', value: memo } : null;
  }
  if (type === 'MEMO_ID') {
    if (!MEMO_ID_RE.test(memo) || BigInt(memo) > UINT64_MAX) return null;
    return { type: 'id', value: memo };
  }
  if (type === 'MEMO_HASH' || type === 'MEMO_RETURN') {
    let bytes;
    try {
      bytes = Buffer.from(memo, 'base64');
    } catch {
      return null;
    }
    if (bytes.length !== 32) return null;
    return { type: type === 'MEMO_HASH' ? 'hash' : 'return', value: bytes.toString('hex') };
  }
  return null;
}

/** Liest eine SEP-7-pay-Anfrage. @returns {{ ok: true, ... } | { ok: false, error: string }} */
export function parseSep7Pay(uri) {
  const m = /^web\+stellar:([a-z]+)\?(.*)$/is.exec(String(uri || '').trim());
  if (!m) return { ok: false, error: 'unrecognized' };
  const operation = m[1].toLowerCase();
  if (operation === 'tx') return { ok: false, error: 'txUnsupported' };
  if (operation !== 'pay') return { ok: false, error: 'unrecognized' };
  const params = parseQuery(m[2]);
  if (!params) return { ok: false, error: 'invalid' };

  const destination = params.get('destination') || '';
  if (isContractAddress(destination)) return { ok: false, error: 'contractAddress' };
  if (!isAccount(destination)) return { ok: false, error: 'invalidDestination' };

  const amount = params.get('amount') || '';
  if (amount && (!AMOUNT_RE.test(amount) || !(Number(amount) > 0))) return { ok: false, error: 'invalidAmount' };

  const code = params.get('asset_code') || '';
  const issuer = params.get('asset_issuer') || '';
  let asset = { isNative: true, code: 'XLM', issuer: '' };
  if (code || issuer) {
    if (!ASSET_CODE_RE.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) return { ok: false, error: 'invalidAsset' };
    asset = { isNative: false, code, issuer };
  }

  let memo = null;
  if (params.has('memo')) {
    memo = memoFromSep7(params.get('memo'), params.get('memo_type'));
    if (!memo) return { ok: false, error: 'invalidMemo' };
  }

  const msg = (params.get('msg') || '').slice(0, MAX_MSG_LENGTH);
  return {
    ok: true,
    kind: 'pay',
    destination,
    amount,
    asset,
    memo,
    networkPassphrase: params.get('network_passphrase') || '',
    msg,
    originDomain: params.get('origin_domain') || '',
    hasSignature: params.has('signature'),
    hasCallback: params.has('callback'),
  };
}

/** Eingabe aus QR-Code oder Einfuegen: reine Adresse, Federation-Adresse oder SEP-7-pay. */
export function parsePaymentInput(raw) {
  const v = String(raw || '').trim();
  if (!v) return { ok: false, error: 'empty' };
  if (isAccount(v) || FEDERATION_RE.test(v)) return { ok: true, kind: 'address', destination: v };
  if (isContractAddress(v)) return { ok: false, error: 'contractAddress' };
  if (/^web\+stellar:/i.test(v)) return parseSep7Pay(v);
  return { ok: false, error: 'unrecognized' };
}

/** true, wenn die Anfrage ein anderes Netzwerk verlangt als das gewaehlte. */
export function networkMismatch(request, network) {
  if (!request?.networkPassphrase) return network === 'TESTNET'; // ohne Angabe gilt laut SEP-7 Mainnet
  const expected = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;
  return request.networkPassphrase !== expected;
}

/** Baut eine SEP-7-pay-Anfrage. memo: { type: 'text'|'id', value } oder null. */
export function buildSep7Pay({ destination, amount = '', asset = null, memo = null, network = 'PUBLIC' }) {
  const parts = [['destination', destination]];
  if (amount) parts.push(['amount', amount]);
  if (asset && !asset.isNative) {
    parts.push(['asset_code', asset.code]);
    parts.push(['asset_issuer', asset.issuer]);
  }
  if (memo?.value) {
    parts.push(['memo', memo.value]);
    parts.push(['memo_type', memo.type === 'id' ? 'MEMO_ID' : 'MEMO_TEXT']);
  }
  if (network === 'TESTNET') parts.push(['network_passphrase', Networks.TESTNET]);
  return `web+stellar:pay?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Prueft die Felder der Empfangen-Seite. @returns {string|null} Fehlerschluessel */
export function validateRequestFields({ amount, memoType, memo }) {
  if (amount && (!AMOUNT_RE.test(amount) || !(Number(amount) > 0))) return 'invalidAmount';
  if (memo) {
    if (memoType === 'id' && (!MEMO_ID_RE.test(memo) || BigInt(memo) > UINT64_MAX)) return 'invalidMemoId';
    if (memoType !== 'id' && textBytes(memo) > 28) return 'memoTooLong';
  }
  return null;
}
