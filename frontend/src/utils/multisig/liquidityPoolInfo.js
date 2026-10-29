// Pool-Assets und aktueller Pool-Stand fuer liquidityPoolDeposit/-Withdraw in
// einem Multisig-Job. Die Operationen enthalten nur die Pool-ID; die Assets
// kommen aus einem changeTrust(LiquidityPoolAsset) derselben Transaktion
// (Quelle 1, nur wenn die daraus berechnete ID passt) oder aus Horizon
// /liquidity_pools/{id} im Netz des Jobs (Quelle 2, ueber normalizeNativePool
// inklusive poolIdMismatch-Pruefung). Alles nur fuer die Anzeige.
import {
  normalizeNativePool,
  poolIdFor,
  priceWithinBounds,
  simulateDeposit,
  toStroops,
} from '../stellar/liquidityPools.js';

const LP_TYPES = new Set(['liquidityPoolDeposit', 'liquidityPoolWithdraw']);

// XDR-Felder sind je nach js-xdr-Version Funktionen oder Properties.
function field(obj, key) {
  const value = obj?.[key];
  return typeof value === 'function' ? value.call(obj) : value;
}

export function hasLiquidityPoolOps(operations) {
  return (Array.isArray(operations) ? operations : []).some((op) => LP_TYPES.has(op?.type));
}

/** Pool-IDs aller LP-Operationen, ohne Duplikate, in Reihenfolge. */
export function collectLiquidityPoolIds(operations) {
  const ids = (Array.isArray(operations) ? operations : [])
    .filter((op) => LP_TYPES.has(op?.type) && op.liquidityPoolId)
    .map((op) => String(op.liquidityPoolId));
  return [...new Set(ids)];
}

/** Quelle 1: { [poolId]: { assetA, assetB } } aus changeTrust(LiquidityPoolAsset), nur bei passender ID. */
export function poolAssetsFromChangeTrust(operations, poolIds) {
  const wanted = new Set(poolIds);
  const out = {};
  (Array.isArray(operations) ? operations : []).forEach((op) => {
    const line = op?.type === 'changeTrust' ? op.line : null;
    if (!line || typeof line.getAssetType !== 'function' || line.getAssetType() !== 'liquidity_pool_shares') return;
    let id;
    try {
      id = poolIdFor(line.assetA, line.assetB);
    } catch {
      return;
    }
    if (wanted.has(id) && !out[id]) out[id] = { assetA: line.assetA, assetB: line.assetB };
  });
  return out;
}

/**
 * Exakte Preisgrenzen { n, d } je Operations-Index aus dem XDR. Das SDK dekodiert
 * minPrice/maxPrice nur als gerundeten Dezimal-String, fuer den Vergleich mit dem
 * Pool-Stand braucht es den Bruch.
 * @returns {Record<number, { minPrice: {n:number,d:number}, maxPrice: {n:number,d:number} }>}
 */
export function exactDepositPrices(tx) {
  const inner = tx?.innerTransaction || tx;
  const rawOps = field(inner?.tx, 'operations');
  const out = {};
  (Array.isArray(rawOps) ? rawOps : []).forEach((rawOp, index) => {
    try {
      const deposit = field(field(rawOp, 'body'), 'liquidityPoolDepositOp');
      if (!deposit) return;
      const toPrice = (p) => ({ n: Number(field(p, 'n')), d: Number(field(p, 'd')) });
      out[index] = { minPrice: toPrice(field(deposit, 'minPrice')), maxPrice: toPrice(field(deposit, 'maxPrice')) };
    } catch {
      /* keine Deposit-Op oder unbekannte XDR-Form */
    }
  });
  return out;
}

function loadError(err) {
  if (err?.message === 'liquidityPools.poolIdMismatch') return 'poolIdMismatch';
  if (err?.response?.status === 404 || err?.name === 'NotFoundError') return 'notFound';
  return 'loadFailed';
}

/**
 * Assets und aktuellen Stand je Pool-ID laden. Ladefehler werfen nicht.
 * @returns {Promise<Record<string, { assetA: object, assetB: object, source: 'changeTrust'|'horizon', pool: object|null, error: string }>>}
 *   Pools ohne bekannte Assets fehlen im Ergebnis.
 */
export async function resolveLiquidityPoolInfo({ operations, server }) {
  const ids = collectLiquidityPoolIds(operations);
  if (!ids.length) return {};
  const fromTrust = poolAssetsFromChangeTrust(operations, ids);
  const entries = await Promise.all(ids.map(async (id) => {
    let pool = null;
    let error = '';
    try {
      // Die Antwort muss zur angefragten ID gehoeren, sonst keine Assets und kein Stand aus Horizon.
      pool = normalizeNativePool(await server.liquidityPools().liquidityPoolId(id).call(), id);
    } catch (err) {
      error = loadError(err);
    }
    const trust = fromTrust[id];
    if (trust) return [id, { assetA: trust.assetA, assetB: trust.assetB, source: 'changeTrust', pool, error }];
    if (pool) return [id, { assetA: pool.assetA, assetB: pool.assetB, source: 'horizon', pool, error }];
    return [id, null];
  }));
  return Object.fromEntries(entries.filter(([, value]) => value));
}

/**
 * Aktueller Stand einer LP-Operation gegen den Pool laut Horizon (nur Anzeige).
 * Deposit: wie stellar-core wird das tatsaechliche Einzahlungsverhaeltnis aus
 * maxAmountA/B gegen die Preisgrenzen geprueft. Withdraw: aktuell zu erwartende
 * Betraege gegen minAmountA/B.
 * @returns {null | { kind: 'deposit', currentPrice: {n:number,d:number}, withinBounds: boolean }
 *   | { kind: 'withdraw', amountA: bigint, amountB: bigint, meetsMinimum: boolean }}
 */
export function evaluateLiquidityOperation(op, pool, exactPrices) {
  if (!op || !pool) return null;
  try {
    if (op.type === 'liquidityPoolDeposit') {
      if (!exactPrices?.minPrice || !exactPrices?.maxPrice) return null;
      const maxA = toStroops(op.maxAmountA);
      const maxB = toStroops(op.maxAmountB);
      const sim = pool.totalShares > 0n
        ? simulateDeposit(pool, maxA, maxB)
        : { shares: maxA > 0n && maxB > 0n ? 1n : 0n, amountA: maxA, amountB: maxB };
      const withinBounds = sim.shares > 0n && priceWithinBounds(sim.amountA, sim.amountB, exactPrices.minPrice, exactPrices.maxPrice);
      return { kind: 'deposit', currentPrice: { n: Number(pool.reserveA), d: Number(pool.reserveB) }, withinBounds };
    }
    if (op.type === 'liquidityPoolWithdraw') {
      const shares = toStroops(op.amount);
      if (pool.totalShares <= 0n || shares > pool.totalShares) {
        return { kind: 'withdraw', amountA: 0n, amountB: 0n, meetsMinimum: false };
      }
      const amountA = (shares * pool.reserveA) / pool.totalShares;
      const amountB = (shares * pool.reserveB) / pool.totalShares;
      const meetsMinimum = amountA >= toStroops(op.minAmountA) && amountB >= toStroops(op.minAmountB);
      return { kind: 'withdraw', amountA, amountB, meetsMinimum };
    }
  } catch {
    return null;
  }
  return null;
}
