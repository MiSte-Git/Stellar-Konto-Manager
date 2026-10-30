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
import { Asset, Keypair, Memo, MuxedAccount, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
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
 * Loest einen unklaren Eintrag ueber Horizon auf:
 * 'success' (im Ledger, erfolgreich), 'failed' (im Ledger, fehlgeschlagen),
 * 'expired' (nicht im Ledger und sicher abgelaufen) oder 'unknown'.
 *
 * "Abgelaufen" haengt nicht an der Client-Uhr: Erst wird der letzte von Horizon
 * aufgenommene Ledger geholt. Liegt dessen closed_at mehr als den Puffer hinter maxTime
 * der Transaktion, kann sie in keinem spaeteren Ledger mehr landen. Wird sie danach auch
 * beim zweiten Versuch nicht gefunden, wurde sie nie angewendet.
 */
export async function resolveAmbiguous({ server, entry, retryDelayMs = 2000 }) {
  let latestClosed = NaN;
  if (Number.isInteger(entry.maxTime)) {
    try {
      const ledgers = await server.ledgers().order('desc').limit(1).call();
      latestClosed = Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
    } catch { /* bleibt unbekannt */ }
  }
  const lookup = async () => {
    try {
      const record = await server.transactions().transaction(entry.hash).call();
      return record?.successful === false ? 'failed' : 'success';
    } catch (e) {
      return e?.response?.status === 404 ? 'notFound' : 'unknown';
    }
  };
  let result = await lookup();
  if (result !== 'notFound') return result;
  const pastValidity = Number.isFinite(latestClosed) && latestClosed > entry.maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
  if (!pastValidity) return 'unknown';
  await new Promise((r) => setTimeout(r, retryDelayMs));
  result = await lookup();
  return result === 'notFound' ? 'expired' : result;
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
