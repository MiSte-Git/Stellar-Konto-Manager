// Batch-Convert (Backlog P1.5b): viele Claimable Balances einloesen und in ein Ziel-Asset
// umwandeln. Pro Eintrag in derselben Transaktion: Trustline anlegen (falls noetig), einloesen,
// per pathPaymentStrictSend in das Ziel tauschen, Trustline wieder loeschen. Danach bleibt nur
// das Ziel-Asset uebrig, und es ist nie mehr als eine temporaere Trustline gleichzeitig offen.
//
// Token-Trust-Prinzip: Das Ziel-Asset waehlt der Nutzer. SKM schlaegt kein Asset vor ausser
// dem nativen XLM als Standard und bewertet keine Token.
import { Asset, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { assetFromPathRecord, ASSET_CODE_RE } from '../../components/trading/assetSearchUtils.js';
import { fromStroops, toStroops } from './claimableBalances.js';

export const MAX_OPS_PER_TX = 100;
export const QUOTE_CONCURRENCY = 4;
export const DEFAULT_BATCH_SLIPPAGE = '2';
export const BATCH_TX_TIMEOUT_SECONDS = 120;

export const NATIVE_TARGET = { isNative: true, code: 'XLM', issuer: '', key: 'XLM' };

export function toSdkAsset(asset) {
  return asset.isNative ? Asset.native() : new Asset(asset.code, asset.issuer);
}

// "XLM" oder "CODE:ISSUER" -> Ziel-Asset, sonst null
export function parseTargetAsset(input) {
  const v = String(input || '').trim();
  if (!v || v.toUpperCase() === 'XLM' || v === 'native') return NATIVE_TARGET;
  const idx = v.indexOf(':');
  if (idx <= 0) return null;
  const code = v.slice(0, idx).trim();
  const issuer = v.slice(idx + 1).trim();
  if (!ASSET_CODE_RE.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) return null;
  return { isNative: false, code, issuer, key: `${code}:${issuer}` };
}

// Mindestbetrag nach Slippage exakt in Stroops, abgerundet. '' wenn nicht sinnvoll.
export function computeDestMin(destinationAmount, slippagePercent) {
  const amount = toStroops(destinationAmount);
  const slip = Number(String(slippagePercent ?? '').replace(',', '.'));
  if (amount == null || amount <= 0n || !Number.isFinite(slip) || slip < 0 || slip > 50) return '';
  const bps = BigInt(Math.round(slip * 100));
  const min = (amount * (10000n - bps)) / 10000n;
  return min > 0n ? fromStroops(min) : '';
}

// Ziel- oder Quell-Asset mit Herausgeber, damit ein Token mit Code XLM nicht wie natives XLM aussieht.
export function assetLabel(asset, shorten = (v) => v) {
  if (!asset || asset.isNative) return 'XLM';
  return `${asset.code} (${shorten(asset.issuer)})`;
}

// Welche Operationen ein Eintrag braucht.
export function planItem(item, target) {
  if (item.asset.key === target.key) return { mode: 'claimOnly', tempTrustline: false, ops: 1 };
  const tempTrustline = !item.asset.isNative && !item.hasTrustline;
  return { mode: 'convert', tempTrustline, ops: 2 + (tempTrustline ? 2 : 0) };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Erzielbaren Betrag pro Eintrag ermitteln. status: ok | notClaimable | ownAsset | authRequired | noMarket | quoteFailed
export async function quoteItem(server, item, target, slippage) {
  const plan = planItem(item, target);
  const base = { item, plan, destAmount: '', destMin: '', path: [] };
  if (!item.claimableNow) return { ...base, status: 'notClaimable' };
  if (item.blockedReason) return { ...base, status: item.blockedReason };
  if (item.isIssuer) return { ...base, status: 'ownAsset' };
  if (plan.mode === 'claimOnly') return { ...base, status: 'ok', destAmount: item.amount, destMin: item.amount };
  try {
    if (plan.tempTrustline) {
      // Eine neue Trustline zu einem Asset mit AUTH_REQUIRED ist nicht freigegeben, das Einloesen
      // wuerde scheitern und die ganze Transaktion mitreissen.
      const issuer = await server.loadAccount(item.asset.issuer);
      if (issuer?.flags?.auth_required) return { ...base, status: 'authRequired' };
    }
    const res = await server.strictSendPaths(toSdkAsset(item.asset), item.amount, [toSdkAsset(target)]).call();
    const records = Array.isArray(res?.records) ? res.records : [];
    const best = [...records].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
    if (!best || !(Number(best.destination_amount) > 0)) return { ...base, status: 'noMarket' };
    const destMin = computeDestMin(best.destination_amount, slippage);
    if (!destMin) return { ...base, status: 'noMarket' };
    return {
      ...base,
      status: 'ok',
      destAmount: String(best.destination_amount),
      destMin,
      path: Array.isArray(best.path) ? best.path.map(assetFromPathRecord) : [],
    };
  } catch (e) {
    console.warn('[SKM] batch convert quote failed', item.id, e);
    return { ...base, status: 'quoteFailed' };
  }
}

export function quoteItems(server, items, target, slippage, { concurrency = QUOTE_CONCURRENCY } = {}) {
  return mapLimit(items, concurrency, (item) => quoteItem(server, item, target, slippage));
}

// Ausgewaehlte Quotes in Transaktionen mit hoechstens MAX_OPS_PER_TX Operationen aufteilen.
// Die Ziel-Trustline (falls noetig) kommt als erste Operation in die erste Transaktion.
export function chunkQuotes(quotes, { needTargetTrustline = false } = {}) {
  const chunks = [];
  let current = [];
  let ops = needTargetTrustline ? 1 : 0;
  for (const q of quotes) {
    if (current.length && ops + q.plan.ops > MAX_OPS_PER_TX) {
      chunks.push(current);
      current = [];
      ops = 0;
    }
    current.push(q);
    ops += q.plan.ops;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function countOps(chunk, includeTargetTrustline) {
  return chunk.reduce((acc, q) => acc + q.plan.ops, includeTargetTrustline ? 1 : 0);
}

export function buildBatchTx({ account, accountId, chunk, target, includeTargetTrustline, fee, networkPassphrase, timeoutSeconds = BATCH_TX_TIMEOUT_SECONDS }) {
  const builder = new TransactionBuilder(account, { fee: String(fee), networkPassphrase });
  const dest = toSdkAsset(target);
  if (includeTargetTrustline) builder.addOperation(Operation.changeTrust({ asset: dest }));
  for (const q of chunk) {
    const src = toSdkAsset(q.item.asset);
    if (q.plan.tempTrustline) builder.addOperation(Operation.changeTrust({ asset: src }));
    builder.addOperation(Operation.claimClaimableBalance({ balanceId: q.item.id }));
    if (q.plan.mode === 'convert') {
      builder.addOperation(Operation.pathPaymentStrictSend({
        sendAsset: src,
        sendAmount: q.item.amount,
        destination: accountId,
        destAsset: dest,
        destMin: q.destMin,
        path: q.path,
      }));
      if (q.plan.tempTrustline) builder.addOperation(Operation.changeTrust({ asset: src, limit: '0' }));
    }
  }
  return builder.setTimeout(timeoutSeconds).build();
}

// Status der Ziel-Trustline im Konto: native | ok | missing | notAuthorized
export function targetTrustlineStatus(account, target) {
  if (target.isNative) return 'native';
  const line = (account?.balances || []).find((b) => b.asset_code === target.code && b.asset_issuer === target.issuer);
  if (!line) return 'missing';
  if (line.is_authorized === false) return 'notAuthorized';
  return 'ok';
}
