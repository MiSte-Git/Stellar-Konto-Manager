// frontend/src/utils/learn/practiceActions.js
// Practice validations (P1..P6) against Horizon Testnet.
// - Always uses Horizon Testnet
// - No secrets are persisted
// - Returns clear success signals and structured proofs
// - Idempotent by design: callers can pass a client nonce to avoid duplicates
// - Errors: throw with submitTransaction.failed:<detail> only for tx-submits (not used here)
// - All user-facing strings must be provided via t(key, default)

import { Horizon, StrKey } from '@stellar/stellar-sdk';
import { getHorizonServer, loadTrustlines } from '../stellar/stellarUtils.js';
import { withBackoff, classifyError } from '../net/retry.js';

const TESTNET = 'https://horizon-testnet.stellar.org';

function nowIso() { return new Date().toISOString(); }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

async function latestBaseReserveXlm(server) {
  // Use latest ledger to get base_reserve_in_stroops
  try {
    const ledgers = await server.ledgers().order('desc').limit(1).call();
    const brStroops = Number(ledgers?.records?.[0]?.base_reserve_in_stroops || 5000000);
    return brStroops / 1e7; // 10M stroops per XLM
  } catch {
    return 0.5; // fallback typical value
  }
}

// Proof helper
function makeProof(name, ok, ref) {
  return { name, ok: !!ok, at: nowIso(), ref };
}

// Internal fetch helpers (with retry/backoff)
async function fetchAccount(server, accountId) {
  return withBackoff(() => server.loadAccount(accountId), { tries: 3, baseDelay: 800, maxDelay: 4000 });
}
async function fetchPaymentsForAccount(server, accountId, { limit = 100 } = {}) {
  return withBackoff(() => server.payments().forAccount(accountId).order('desc').limit(Math.min(200, Math.max(10, limit))).join('transactions').call(), { tries: 3, baseDelay: 800, maxDelay: 4000 });
}
async function fetchTradesForAccount(server, accountId, { limit = 100 } = {}) {
  return withBackoff(() => server.trades().forAccount(accountId).order('desc').limit(Math.min(200, Math.max(10, limit))).call(), { tries: 3, baseDelay: 800, maxDelay: 4000 });
}

// P1: Konto anlegen → Erwartung: neue G…-Adresse, noch inaktiv.
export async function validateAccountCreated({ accountId }) {
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    return makeProof('p1_account_created', false, { reason: 'invalid_public_key' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    await fetchAccount(server, accountId);
    // If account exists already, it's not a "new inactive" account
    return makeProof('p1_account_created', false, { reason: 'account_already_exists', accountId });
  } catch (e) {
    const status = e?.response?.status || e?.status;
    if (status === 404) {
      // Good: does not exist yet
      const url = `${String(server.serverURL)}/accounts/${accountId}`;
      return makeProof('p1_account_created', true, { type: 'account', url, accountId });
    }
    const c = classifyError(e);
    return makeProof('p1_account_created', false, { reason: c.type || 'network_error' });
  }
}

// P2: Konto aktivieren → Erwartung: Mindestreserve erfüllt, sequence > 0.
export async function validateAccountActivated({ accountId }) {
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    return makeProof('p2_account_activated', false, { reason: 'invalid_public_key' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    const [acc, baseReserve] = await Promise.all([
      fetchAccount(server, accountId),
      latestBaseReserveXlm(server),
    ]);
    const native = (acc?.balances || []).find(b => b.asset_type === 'native');
    const xlm = native ? num(native.balance) : 0;
    const sub = num(acc.subentry_count);
    const sponsoring = num(acc.num_sponsoring);
    const sponsored = num(acc.num_sponsored);
    const minReq = baseReserve * (2 + sub + sponsoring - sponsored);
    const hasSeq = !!acc.sequence && num(acc.sequence) > 0;
    const ok = hasSeq && xlm >= minReq;
    const url = `${String(server.serverURL)}/accounts/${accountId}`;
    return makeProof('p2_account_activated', ok, { type: 'account', url, accountId, xlm, minRequired: minReq, sequence: acc.sequence });
  } catch (e) {
    const c = classifyError(e);
    return makeProof('p2_account_activated', false, { reason: c.type || 'network_error' });
  }
}

// P3: Trustline setzen (Asset X) → Trustline im Konto vorhanden
export async function validateTrustlinePresent({ accountId, assetCode, assetIssuer }) {
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    return makeProof('p3_trustline_added', false, { reason: 'invalid_public_key' });
  }
  if (!assetCode || !assetIssuer || !StrKey.isValidEd25519PublicKey(assetIssuer)) {
    return makeProof('p3_trustline_added', false, { reason: 'invalid_asset' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    const tls = await loadTrustlines(accountId, server);
    const ok = tls.some(a => a.assetCode === assetCode && a.assetIssuer === assetIssuer);
    const url = `${String(server.serverURL)}/accounts/${accountId}`;
    return makeProof('p3_trustline_added', ok, { type: 'trustline', url, accountId, assetCode, assetIssuer });
  } catch (e) {
    const c = classifyError(e);
    return makeProof('p3_trustline_added', false, { reason: c.type || 'network_error' });
  }
}

// P4: Token empfangen (Asset X) → Balance > 0 für Asset X (minAmount optional)
export async function validateTokenReceived({ accountId, assetCode, assetIssuer, minAmount = 0 }) {
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    return makeProof('p4_token_received', false, { reason: 'invalid_public_key' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    const tls = await loadTrustlines(accountId, server);
    const bal = tls.find(a => a.assetCode === assetCode && a.assetIssuer === assetIssuer);
    const amount = bal ? num(bal.assetBalance) : 0;
    const ok = amount >= num(minAmount);
    const url = `${String(server.serverURL)}/accounts/${accountId}`;
    return makeProof('p4_token_received', ok, { type: 'balance', url, accountId, assetCode, assetIssuer, amount, minAmount });
  } catch (e) {
    const c = classifyError(e);
    return makeProof('p4_token_received', false, { reason: c.type || 'network_error' });
  }
}

// P5: Token senden → Zahlungs-Operation bestätigt (from, to, asset, amount)
export async function validatePaymentSent({ sourceId, destinationId, assetCode = 'XLM', assetIssuer, minAmount = 0, sinceISO }) {
  if (!StrKey.isValidEd25519PublicKey(sourceId) || !StrKey.isValidEd25519PublicKey(destinationId)) {
    return makeProof('p5_payment_sent', false, { reason: 'invalid_public_key' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    let page = await fetchPaymentsForAccount(server, sourceId, { limit: 100 });
    const sinceTs = sinceISO ? Date.parse(sinceISO) : 0;
    let found = null;

    while (true) {
      for (const op of page.records || []) {
        const createdTs = Date.parse(op.created_at || '') || 0;
        if (sinceTs && createdTs < sinceTs) {
          // We scanned far enough into the past
          page.records = []; // end
          break;
        }
        const from = op.from || op.source_account;
        const to = op.to || op.to_muxed || op.destination;
        const isNative = (assetCode === 'XLM');
        const opAssetCode = op.asset_code || op.asset || op.asset_code_sold || op.asset_code_bought;
        const opIssuer = op.asset_issuer || op.asset_issuer_sold || op.asset_issuer_bought;
        const amount = num(op.amount || op.amount_sent || op.amount_received || op.source_amount || op.dest_amount);
        const typeOk = op.type === 'payment' || op.type?.startsWith('path_payment');
        const assetOk = isNative ? (op.asset_type === 'native') : (opAssetCode === assetCode && opIssuer === assetIssuer);
        const partiesOk = from === sourceId && to === destinationId;
        const amtOk = amount >= num(minAmount);
        if (typeOk && assetOk && partiesOk && amtOk) {
          found = { id: op.id, tx: op.transaction_hash, created_at: op.created_at, amount, assetCode, assetIssuer: isNative ? undefined : assetIssuer };
          break;
        }
      }
      if (found || !page.next || !page.records || page.records.length === 0) break;
      page = await page.next();
    }

    const ok = !!found;
    const url = found ? `${String(server.serverURL)}/transactions/${found.tx}` : `${String(server.serverURL)}/accounts/${sourceId}/payments`;
    return makeProof('p5_payment_sent', ok, { type: 'payment', url, ...found, sourceId, destinationId });
  } catch (e) {
    const c = classifyError(e);
    return makeProof('p5_payment_sent', false, { reason: c.type || 'network_error' });
  }
}

// P6: einfacher Handel → trades oder offers enthält Eintrag mit passenden Feldern
export async function validateSimpleTrade({ accountId, baseAsset, counterAsset, minAmount = 0 }) {
  // baseAsset/counterAsset: { code: 'XLM'|'USD'..., issuer?: 'G...' }
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    return makeProof('p6_trade_recorded', false, { reason: 'invalid_public_key' });
  }
  const server = getHorizonServer(TESTNET);
  try {
    let page = await fetchTradesForAccount(server, accountId, { limit: 100 });
    let found = null;

    const isNative = (a) => !a || a.code === 'XLM' || a.asset_type === 'native';
    const matchAsset = (gotCode, gotIssuer, want) => {
      if (isNative(want)) return (gotCode == null && gotIssuer == null) || gotCode === 'XLM';
      return gotCode === want.code && gotIssuer === want.issuer;
    };

    while (true) {
      for (const tr of page.records || []) {
        // Check either side of trade matches the pair
        const sellsBase = matchAsset(tr.base_asset_code, tr.base_asset_issuer, baseAsset) && matchAsset(tr.counter_asset_code, tr.counter_asset_issuer, counterAsset);
        const sellsCounter = matchAsset(tr.base_asset_code, tr.base_asset_issuer, counterAsset) && matchAsset(tr.counter_asset_code, tr.counter_asset_issuer, baseAsset);
        const amt = num(tr.base_amount) + num(tr.counter_amount);
        if ((sellsBase || sellsCounter) && amt >= num(minAmount)) {
          found = { id: tr.id, base_amount: tr.base_amount, counter_amount: tr.counter_amount, price: tr.price, created_at: tr.ledger_close_time };
          break;
        }
      }
      if (found || !page.next || !page.records || page.records.length === 0) break;
      page = await page.next();
    }

    const ok = !!found;
    const url = `${String(server.serverURL)}/accounts/${accountId}/trades`;
    return makeProof('p6_trade_recorded', ok, { type: 'trade', url, accountId, ...found, baseAsset, counterAsset });
  } catch (e) {
    const c = classifyError(e);
    return makeProof('p6_trade_recorded', false, { reason: c.type || 'network_error' });
  }
}

export const PracticeValidators = {
  p1_account_created: validateAccountCreated,
  p2_account_activated: validateAccountActivated,
  p3_trustline_added: validateTrustlinePresent,
  p4_token_received: validateTokenReceived,
  p5_payment_sent: validatePaymentSent,
  p6_trade_recorded: validateSimpleTrade,
};

// Run a practice validation with basic rate limiting and optional clientNonce
export async function runPracticeValidation(actionId, params = {}, t) {
  const server = getHorizonServer(TESTNET);
  const fn = PracticeValidators[actionId];
  if (!fn) throw new Error((t?.('learn.error.unknown_action', 'Unknown practice action')) || 'Unknown practice action');

  // Rate limiting: at most one call per action every 1500 ms
  const kMeta = 'skm.learn.progress.v1.practiceMeta';
  let meta = {};
  try { meta = JSON.parse(localStorage.getItem(kMeta) || '{}') || {}; } catch { /* noop */ }
  const lastAt = Number(meta[actionId]?.lastAt || 0);
  const now = Date.now();
  if (now - lastAt < 1200) {
    const msg = t?.('learn.error.rate_limited', 'Please slow down. Try again in a moment.') || 'rate limited';
    return { status: 'rate_limited', message: msg };
  }

  // Mark start
  meta[actionId] = { lastAt: now };
  try { localStorage.setItem(kMeta, JSON.stringify(meta)); } catch { /* noop */ }

  // Status: validating
  // const startMsg = t?.('learn.status.validating', 'Validating…');

  try {
    const proof = await fn(params, server);
    const ok = !!proof.ok;
    const successMsg = t?.('learn.status.success', 'Success');
    return { status: ok ? 'success' : 'partial', message: ok ? successMsg : (t?.('learn.status.validation', 'Validation incomplete') || 'Validation incomplete'), proof };
  } catch (e) {
    const c = classifyError(e);
    if (c.type === 'timeout') {
      return { status: 'aborted', message: t?.('learn.error.horizon_timeout', 'Horizon timeout. Please retry.') };
    }
    if (c.type === 'rateLimit') {
      return { status: 'aborted', message: t?.('learn.error.rate_limited', 'Rate limited by Horizon. Please wait and retry.') };
    }
    return { status: 'aborted', message: t?.('learn.error.network', 'Network error. Please retry.') };
  }
}
