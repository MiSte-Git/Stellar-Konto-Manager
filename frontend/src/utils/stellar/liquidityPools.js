// Reine Hilfsfunktionen fuer native Stellar Liquidity Pools (CAP-38, constant
// product, Fee 30 bps). Keine Horizon-Aufrufe, kein React.
//
// Das Pool-/Positionsmodell ist bewusst quellenneutral (`source`), damit spaeter
// Soroban-AMMs als weitere Quelle dazukommen koennen (siehe konzept_liquidity_pools.md).
// Betraege werden intern als Stroop-BigInt gefuehrt (7 Dezimalen), nie als Float.
import { Asset, getLiquidityPoolId, LiquidityPoolFeeV18 } from '@stellar/stellar-sdk';

export const POOL_SOURCE_NATIVE = 'native';
export const POOL_ID_RE = /^[0-9a-f]{64}$/;
const STROOP_DECIMALS = 7;
const STROOPS_PER_UNIT = 10n ** BigInt(STROOP_DECIMALS);
const AMOUNT_STRING_RE = /^(\d+)(?:\.(\d+))?$/;

/** true, wenn value eine gueltige Pool-ID ist (64 Hex-Zeichen, klein). */
export function isValidPoolId(value) {
  return POOL_ID_RE.test(String(value || ''));
}

/**
 * Dezimal-String (z. B. '1000.0000000' aus Horizon) -> Stroops als BigInt.
 * Mehr als 7 Nachkommastellen werden abgeschnitten (abgerundet). Ungueltige
 * Eingaben (negativ, leer, Exponent-Schreibweise) werfen einen Fehler.
 */
export function toStroops(value) {
  if (typeof value === 'bigint') return value;
  const str = String(value ?? '').trim();
  const m = AMOUNT_STRING_RE.exec(str);
  if (!m) throw new Error(`liquidityPools.invalidAmount:${str}`);
  const frac = (m[2] || '').slice(0, STROOP_DECIMALS).padEnd(STROOP_DECIMALS, '0');
  return BigInt(m[1]) * STROOPS_PER_UNIT + BigInt(frac);
}

/** Stroops (BigInt) -> Dezimal-String mit genau 7 Nachkommastellen. */
export function fromStroops(stroops) {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(STROOP_DECIMALS, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * Kanonische Reihenfolge fuer Pool-Assets (A < B laut Asset.compare).
 * swapped = true, wenn die Eingabereihenfolge umgedreht wurde. Die UI zeigt
 * die Nutzerreihenfolge, Operationen brauchen die kanonische.
 */
export function sortPoolAssets(a, b) {
  const cmp = Asset.compare(a, b);
  if (cmp === 0) throw new Error('liquidityPools.sameAsset');
  return cmp < 0
    ? { assetA: a, assetB: b, swapped: false }
    : { assetA: b, assetB: a, swapped: true };
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Pool-ID (64 Hex-Zeichen) fuer ein Asset-Paar, Eingabereihenfolge beliebig. */
export function poolIdFor(a, b) {
  const { assetA, assetB } = sortPoolAssets(a, b);
  return bytesToHex(getLiquidityPoolId('constant_product', { assetA, assetB, fee: LiquidityPoolFeeV18 }));
}

/** Horizon-Format 'native' bzw. 'CODE:ISSUER' -> Asset. */
export function parseHorizonPoolAsset(str) {
  const value = String(str || '').trim();
  if (value === 'native') return Asset.native();
  const idx = value.indexOf(':');
  if (idx <= 0 || idx !== value.lastIndexOf(':')) throw new Error(`liquidityPools.invalidAsset:${value}`);
  return new Asset(value.slice(0, idx), value.slice(idx + 1));
}

/**
 * Horizon-Record von /liquidity_pools/{id} -> einheitliches Pool-Modell.
 * Die Reserven werden ueber das Asset zugeordnet, nicht ueber die Position im
 * Array, und die Assets kanonisch sortiert.
 */
export function normalizeNativePool(record) {
  const reserves = Array.isArray(record?.reserves) ? record.reserves : [];
  if (reserves.length !== 2) throw new Error('liquidityPools.invalidRecord');
  const parsed = reserves.map((r) => ({ asset: parseHorizonPoolAsset(r.asset), amount: toStroops(r.amount) }));
  const { swapped } = sortPoolAssets(parsed[0].asset, parsed[1].asset);
  const [first, second] = swapped ? [parsed[1], parsed[0]] : parsed;
  return {
    source: POOL_SOURCE_NATIVE,
    poolId: String(record.id || ''),
    assetA: first.asset,
    assetB: second.asset,
    reserveA: first.amount,
    reserveB: second.amount,
    totalShares: toStroops(record.total_shares ?? '0'),
    feeBps: Number(record.fee_bp ?? LiquidityPoolFeeV18),
    totalTrustlines: Number(record.total_trustlines ?? 0),
  };
}

/**
 * Position eines Kontos aus einem liquidity_pool_shares-Balance-Eintrag.
 * amountX = shares * reserveX / totalShares (abgerundet). sharePercent ist
 * nur fuer die Anzeige gedacht (Number, 4 Nachkommastellen genau).
 * Bei totalShares = 0 sind Anteil und Gegenwert 0.
 */
export function positionFromBalance(balance, pool) {
  const shares = toStroops(balance?.balance ?? '0');
  const total = pool?.totalShares ?? 0n;
  const hasShares = total > 0n;
  const amountA = hasShares ? (shares * pool.reserveA) / total : 0n;
  const amountB = hasShares ? (shares * pool.reserveB) / total : 0n;
  // Anteil in Hundertstel-Basispunkten (1e-6), danach erst nach Number.
  const sharePercent = hasShares ? Number((shares * 100_000_000n) / total) / 1_000_000 : 0;
  return {
    source: pool?.source || POOL_SOURCE_NATIVE,
    poolId: String(balance?.liquidity_pool_id || pool?.poolId || ''),
    shares,
    sharePercent,
    amountA,
    amountB,
  };
}

/**
 * Pool-Seiten in Anzeigereihenfolge: firstAsset zuerst, sofern es zum Pool
 * gehoert, sonst kanonisch (A/B). Liefert [{ asset, reserve }, { asset, reserve }].
 */
export function poolSidesInOrder(pool, firstAsset) {
  const a = { asset: pool.assetA, reserve: pool.reserveA };
  const b = { asset: pool.assetB, reserve: pool.reserveB };
  return firstAsset && pool.assetB.equals(firstAsset) ? [b, a] : [a, b];
}
