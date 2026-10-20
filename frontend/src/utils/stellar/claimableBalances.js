// Claimable Balances (Backlog P1.5): laden, einordnen und einloesen.
//
// Token-Trust-Prinzip: Hier wird nur nach Fakten sortiert (XLM / vorhandene Trustline /
// keine Trustline), nie danach, ob ein Token echt oder serioes ist.
import { Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

export const CLAIMABLE_FETCH_LIMIT = 200;
export const CLAIM_TX_TIMEOUT_SECONDS = 60;

export async function fetchClaimableBalances(server, accountId) {
  const page = await server.claimableBalances().claimant(accountId).limit(CLAIMABLE_FETCH_LIMIT).call();
  const records = Array.isArray(page?.records) ? page.records : [];
  return { records, truncated: records.length >= CLAIMABLE_FETCH_LIMIT };
}

// Horizon: "native" oder "CODE:ISSUER"
export function parseClaimableAsset(assetString) {
  const v = String(assetString || '');
  if (v === 'native') return { isNative: true, code: 'XLM', issuer: '', key: 'XLM' };
  const idx = v.indexOf(':');
  if (idx <= 0) return null;
  const code = v.slice(0, idx);
  const issuer = v.slice(idx + 1);
  if (!code || !issuer) return null;
  return { isNative: false, code, issuer, key: `${code}:${issuer}` };
}

function toEpochSeconds(value) {
  if (value == null || value === '') return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

// Wertet ein Horizon-Claim-Predicate zum Zeitpunkt nowSec aus.
// createdSec dient als Basis fuer rel_before (Sekunden ab Erstellung).
// Unbekannte Formen gelten als nicht erfuellt (fail-closed: lieber nicht einloesbar anzeigen).
export function evaluatePredicate(predicate, nowSec, createdSec) {
  if (!predicate || typeof predicate !== 'object') return false;
  if (predicate.unconditional) return true;
  if (Array.isArray(predicate.and)) return predicate.and.length === 2 && predicate.and.every((p) => evaluatePredicate(p, nowSec, createdSec));
  if (Array.isArray(predicate.or)) return predicate.or.length === 2 && predicate.or.some((p) => evaluatePredicate(p, nowSec, createdSec));
  if (predicate.not) return !evaluatePredicate(predicate.not, nowSec, createdSec);
  if (predicate.abs_before != null || predicate.abs_before_epoch != null) {
    const before = toEpochSeconds(predicate.abs_before_epoch ?? predicate.abs_before);
    return before != null && nowSec < before;
  }
  if (predicate.rel_before != null) {
    const rel = Number(predicate.rel_before);
    if (!Number.isFinite(rel) || createdSec == null) return false;
    return nowSec < createdSec + rel;
  }
  return false;
}

// Fuer die Anzeige nur die beiden haeufigen einfachen Formen: einloesbar bis / ab Zeitpunkt.
export function describePredicateWindow(predicate) {
  if (!predicate || typeof predicate !== 'object') return null;
  if (predicate.abs_before != null || predicate.abs_before_epoch != null) {
    const until = toEpochSeconds(predicate.abs_before_epoch ?? predicate.abs_before);
    return until != null ? { until } : null;
  }
  const inner = predicate.not;
  if (inner && (inner.abs_before != null || inner.abs_before_epoch != null)) {
    const from = toEpochSeconds(inner.abs_before_epoch ?? inner.abs_before);
    return from != null ? { from } : null;
  }
  return null;
}

// Ordnet die Records fuer ein Konto ein. account = Horizon-AccountResponse des Empfaengers.
export function classifyClaimableBalances(records, account, nowSec = Math.floor(Date.now() / 1000)) {
  const accountId = account?.account_id || account?.id || '';
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const trustlines = new Set(
    balances.filter((b) => b.asset_type !== 'native' && b.asset_code).map((b) => `${b.asset_code}:${b.asset_issuer}`)
  );
  return (Array.isArray(records) ? records : [])
    .map((r) => {
      const asset = parseClaimableAsset(r?.asset);
      const claimant = (r?.claimants || []).find((c) => c?.destination === accountId);
      if (!asset || !claimant || !r?.id) return null;
      const createdSec = toEpochSeconds(r.last_modified_time);
      const claimableNow = evaluatePredicate(claimant.predicate, nowSec, createdSec);
      return {
        id: r.id,
        amount: String(r.amount || '0'),
        asset,
        sponsor: r.sponsor || '',
        claimableNow,
        window: describePredicateWindow(claimant.predicate),
        hasTrustline: asset.isNative || trustlines.has(asset.key),
        isIssuer: !asset.isNative && asset.issuer === accountId,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.claimableNow) - Number(a.claimableNow));
}

// Eine Transaktion: falls noetig zuerst die Trustline, dann das Einloesen.
export function buildClaimTx({ account, item, fee, networkPassphrase, timeoutSeconds = CLAIM_TX_TIMEOUT_SECONDS }) {
  const builder = new TransactionBuilder(account, { fee: String(fee), networkPassphrase });
  if (!item.asset.isNative && !item.hasTrustline && !item.isIssuer) {
    builder.addOperation(Operation.changeTrust({ asset: new Asset(item.asset.code, item.asset.issuer) }));
  }
  builder.addOperation(Operation.claimClaimableBalance({ balanceId: item.id }));
  return builder.setTimeout(timeoutSeconds).build();
}

// Gueltigkeit eines Multisig-Jobs zum Einloesen: Einstellung Multisig-Timeout, aber nicht
// laenger als die Claimable Balance einloesbar ist. null = zu wenig Zeit fuer einen Job.
export const MIN_JOB_WINDOW_SECONDS = 300;
export function claimJobTimeoutSeconds(item, multisigTimeoutSeconds, nowSec = Math.floor(Date.now() / 1000)) {
  const configured = Math.max(60, Number(multisigTimeoutSeconds || 0) || 86400);
  const until = item?.window?.until;
  if (until == null) return configured;
  const remaining = Math.floor(until - nowSec) - 30;
  if (remaining < MIN_JOB_WINDOW_SECONDS) return null;
  return Math.min(configured, remaining);
}

// Ausgeblendete Eintraege pro Netzwerk und Konto (reine Ansichtsoption, kein Sicherheitsmerkmal).
function hiddenKey(network, accountId) {
  return `skm.claimable.hidden.${network}.${accountId}`;
}

export function getHiddenClaimableIds(network, accountId) {
  try {
    const raw = window.localStorage?.getItem(hiddenKey(network, accountId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function setHiddenClaimableIds(network, accountId, ids) {
  try {
    window.localStorage?.setItem(hiddenKey(network, accountId), JSON.stringify(Array.from(new Set(ids))));
  } catch { /* noop */ }
}
