// Vorpruefungen fuer Liquidity-Pool-Einzahlungen und -Abhebungen (reine Funktionen).
// Alle Betraege als Stroop-BigInt. Ergebnisse sind Fakten (Trustline fehlt, nicht
// autorisiert, Guthaben reicht nicht), keine Bewertung von Asset oder Pool.
// problems sperren die Aktion, infos (z. B. Clawback aktiv) sind nur Hinweise:
// Clawback-Assets sind laut CAP-38 poolfaehig.
//
// Ist das Konto selbst Issuer eines Pool-Assets, braucht es dafuer keine Trustline;
// stellar-core behandelt das wie eine Trustline mit unbegrenztem Guthaben und Limit.
import { DEFAULT_BASE_RESERVE_XLM } from './walletSummary.js';
import { toStroops } from './liquidityPools.js';

export const BASE_RESERVE_STROOPS = toStroops(String(DEFAULT_BASE_RESERVE_XLM));
// Eine Pool-Share-Trustline zaehlt als 2 Subentries, eine Asset-Trustline als 1.
export const POOL_TRUST_SUBENTRIES = 2n;
export const ASSET_TRUST_SUBENTRIES = 1n;

function big(value) {
  try {
    return toStroops(String(value ?? '0'));
  } catch {
    return 0n;
  }
}

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : 0n;
}

export function assetKey(asset) {
  return asset.isNative() ? 'native' : `${asset.getCode()}:${asset.getIssuer()}`;
}

function accountIdOf(account) {
  if (typeof account?.accountId === 'function') return account.accountId();
  return account?.account_id || account?.id || '';
}

/** true, wenn das Konto Issuer des (nicht nativen) Assets ist. */
export function isOwnIssuedAsset(account, asset) {
  return !asset.isNative() && !!asset.getIssuer() && asset.getIssuer() === accountIdOf(account);
}

export function findAssetLine(account, asset) {
  return (account?.balances || []).find(
    (b) => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
      && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
  ) || null;
}

export function findPoolShareLine(account, poolId) {
  return (account?.balances || []).find(
    (b) => b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id === poolId
  ) || null;
}

/**
 * Mindestreserve in Stroops: (2 + Subentries + Sponsoring - Sponsored + extra) * Base Reserve.
 * Gleiche Regel wie computeWalletSummary, nur in BigInt und mit zusaetzlichen Subentries.
 */
export function minimumReserveStroops(account, extraSubentries = 0n, baseReserve = BASE_RESERVE_STROOPS) {
  const entries = 2n + int(account?.subentry_count) + int(account?.num_sponsoring) - int(account?.num_sponsored) + extraSubentries;
  return (entries > 0n ? entries : 0n) * baseReserve;
}

/** Frei verfuegbares XLM nach Reserve (inkl. extraSubentries) und Fee; kann negativ sein. */
export function availableXlmStroops(account, { extraSubentries = 0n, feeStroops = 0n, baseReserve = BASE_RESERVE_STROOPS } = {}) {
  const native = (account?.balances || []).find((b) => b.asset_type === 'native');
  return big(native?.balance) - big(native?.selling_liabilities) - minimumReserveStroops(account, extraSubentries, baseReserve) - feeStroops;
}

/**
 * Prueft eine Einzahlung gegen den aktuellen Kontostand.
 * @param {{ account: object, pool: object, poolId?: string, maxAmountA: bigint, maxAmountB: bigint, feePerOp: string|number, issuerFlags?: Record<string, object>, baseReserve?: bigint }} params
 *   issuerFlags: Horizon-flags des Issuers je assetKey, noetig fuer fehlende Trustlines
 *   (auth_required, auth_clawback_enabled).
 * @returns {{ sides: object[], missingTrustAssets: object[], needPoolTrust: boolean, newSubentries: bigint, opCount: number, feeStroops: bigint, reserveIncrease: bigint, xlmAvailable: bigint, problems: {code: string, side?: 'A'|'B'}[], infos: {code: string, side: 'A'|'B'}[] }}
 */
export function checkDepositPreconditions({ account, pool, poolId, maxAmountA, maxAmountB, feePerOp, issuerFlags = {}, baseReserve = BASE_RESERVE_STROOPS }) {
  const problems = [];
  const infos = [];
  const sides = [['A', pool.assetA, maxAmountA], ['B', pool.assetB, maxAmountB]].map(([side, asset, required]) => {
    if (asset.isNative()) return { side, asset, trustline: 'native', authorized: true, clawback: false, authRequired: false, balance: 0n, required };
    if (isOwnIssuedAsset(account, asset)) return { side, asset, trustline: 'issuer', authorized: true, clawback: false, authRequired: false, balance: null, required };
    const line = findAssetLine(account, asset);
    const flags = issuerFlags[assetKey(asset)] || {};
    if (!line) {
      return { side, asset, trustline: 'missing', authorized: false, clawback: !!flags.auth_clawback_enabled, authRequired: !!flags.auth_required, balance: 0n, required };
    }
    return {
      side,
      asset,
      trustline: 'present',
      authorized: line.is_authorized !== false,
      clawback: line.is_clawback_enabled === true,
      authRequired: !!flags.auth_required,
      balance: big(line.balance) - big(line.selling_liabilities),
      required,
    };
  });

  const missingTrustAssets = sides.filter((s) => s.trustline === 'missing').map((s) => s.asset);
  const needPoolTrust = !findPoolShareLine(account, poolId || pool.poolId);
  const newSubentries = BigInt(missingTrustAssets.length) * ASSET_TRUST_SUBENTRIES + (needPoolTrust ? POOL_TRUST_SUBENTRIES : 0n);
  const opCount = missingTrustAssets.length + (needPoolTrust ? 1 : 0) + 1;
  const feeStroops = BigInt(Math.max(0, Math.trunc(Number(feePerOp) || 0))) * BigInt(opCount);
  const xlmAvailable = availableXlmStroops(account, { extraSubentries: newSubentries, feeStroops, baseReserve });

  sides.forEach((s) => {
    if (s.trustline === 'native') {
      if (xlmAvailable < s.required) problems.push({ code: 'insufficientBalance', side: s.side });
      return;
    }
    if (s.trustline === 'issuer') return;
    if (s.clawback) infos.push({ code: 'clawbackEnabled', side: s.side });
    if (s.trustline === 'missing') {
      if (s.authRequired) problems.push({ code: 'authRequiredMissingTrust', side: s.side });
      problems.push({ code: 'missingTrustNoBalance', side: s.side });
      return;
    }
    if (!s.authorized) problems.push({ code: 'notAuthorized', side: s.side });
    if (s.balance < s.required) problems.push({ code: 'insufficientBalance', side: s.side });
  });
  if (!sides.some((s) => s.trustline === 'native') && xlmAvailable < 0n) problems.push({ code: 'insufficientXlmReserve' });

  return {
    sides,
    missingTrustAssets,
    needPoolTrust,
    newSubentries,
    opCount,
    feeStroops,
    reserveIncrease: newSubentries * baseReserve,
    xlmAvailable,
    problems,
    infos,
  };
}

/**
 * Prueft eine Abhebung: Share-Bestand, Platz in den Asset-Trustlines (Limit minus
 * Bestand minus buying_liabilities, sonst op_line_full) und XLM fuer die Fee.
 * Fuer XLM und fuer selbst ausgegebene Assets entfaellt die Platzpruefung.
 */
export function checkWithdrawPreconditions({ account, pool, poolId, shares, amountA, amountB, feePerOp, opCount = 1, baseReserve = BASE_RESERVE_STROOPS }) {
  const problems = [];
  const shareLine = findPoolShareLine(account, poolId || pool.poolId);
  const shareBalance = big(shareLine?.balance);
  if (!shareLine || shares > shareBalance) problems.push({ code: 'insufficientShares' });
  [['A', pool.assetA, amountA], ['B', pool.assetB, amountB]].forEach(([side, asset, amount]) => {
    if (asset.isNative() || isOwnIssuedAsset(account, asset)) return;
    const line = findAssetLine(account, asset);
    if (!line) {
      problems.push({ code: 'missingAssetTrust', side });
      return;
    }
    const room = big(line.limit) - big(line.balance) - big(line.buying_liabilities);
    if (room < amount) problems.push({ code: 'lineFull', side });
  });
  const feeStroops = BigInt(Math.max(0, Math.trunc(Number(feePerOp) || 0))) * BigInt(opCount);
  if (availableXlmStroops(account, { feeStroops, baseReserve }) < 0n) problems.push({ code: 'insufficientXlmFee' });
  return { shareBalance, feeStroops, problems };
}
