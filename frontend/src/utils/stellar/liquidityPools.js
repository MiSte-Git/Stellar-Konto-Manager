// Reine Hilfsfunktionen fuer native Stellar Liquidity Pools (CAP-38, constant
// product, Fee 30 bps). Keine Horizon-Aufrufe, kein React.
//
// Das Pool-/Positionsmodell ist bewusst quellenneutral (`source`), damit spaeter
// Soroban-AMMs als weitere Quelle dazukommen koennen (siehe konzept_liquidity_pools.md).
// Betraege werden intern als Stroop-BigInt gefuehrt (7 Dezimalen), nie als Float.
import { Asset, getLiquidityPoolId, LiquidityPoolAsset, LiquidityPoolFeeV18 } from '@stellar/stellar-sdk';

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
 * Array, und die Assets kanonisch sortiert. Die aus den Assets berechnete
 * Pool-ID muss record.id entsprechen und, falls angegeben, der angefragten
 * expectedPoolId; sonst wirft die Funktion liquidityPools.poolIdMismatch
 * (Horizon-Daten nicht konsistent oder Antwort fuer einen anderen Pool).
 */
export function normalizeNativePool(record, expectedPoolId) {
  const reserves = Array.isArray(record?.reserves) ? record.reserves : [];
  if (reserves.length !== 2) throw new Error('liquidityPools.invalidRecord');
  const parsed = reserves.map((r) => ({ asset: parseHorizonPoolAsset(r.asset), amount: toStroops(r.amount) }));
  const { swapped } = sortPoolAssets(parsed[0].asset, parsed[1].asset);
  const [first, second] = swapped ? [parsed[1], parsed[0]] : parsed;
  const poolId = String(record.id || '');
  if (poolIdFor(first.asset, second.asset) !== poolId) throw new Error('liquidityPools.poolIdMismatch');
  if (expectedPoolId !== undefined && poolId !== String(expectedPoolId)) throw new Error('liquidityPools.poolIdMismatch');
  return {
    source: POOL_SOURCE_NATIVE,
    poolId,
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

// ---------------------------------------------------------------------------
// Einzahlen / Abheben (Stufe 2a)
//
// Rundungsregeln (alle Werte Stroop-BigInt):
// - Gegenseite beim Einzahlen: aufrunden (der Nutzer stellt eher etwas mehr bereit,
//   der Pool nimmt nie mehr als maxAmountA/B).
// - erwartete Shares und Auszahlungsbetraege: abrunden (wie stellar-core).
// - Preisgrenzen: minPrice nur abrunden, maxPrice nur aufrunden, sodass der
//   Pool-Preis p = rA/rB immer in [minPrice, maxPrice] liegt.

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 500;
const BPS = 10000n;
// Groesster Wert fuer Zaehler/Nenner eines Stellar-Preises (int32).
export const PRICE_INT_MAX = 2147483647n;

/** Slippage in Basispunkten auf 10..500 begrenzen, ungueltige Werte -> 50. */
export function clampSlippageBps(value) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(n)));
}

/** LiquidityPoolAsset (Fee 30) fuer ein Asset-Paar, Eingabereihenfolge beliebig. */
export function poolAssetFor(a, b) {
  const { assetA, assetB } = sortPoolAssets(a, b);
  return new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18);
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function cmpFrac(p, q, n, d) {
  const l = p * d;
  const r = n * q;
  return l < r ? -1 : (l > r ? 1 : 0);
}

/**
 * Bruch N/D (BigInt, > 0) als Stellar-Preis { n, d } mit n, d <= int32-Max.
 * mode 'floor': groesster darstellbarer Bruch <= N/D; 'ceil': kleinster >= N/D.
 * Ist N/D exakt darstellbar, wird er exakt geliefert. Stern-Brocot-Abstieg in
 * Bloecken (Kettenbruch), daher nur O(log) Schritte. Liefert null, wenn kein
 * gueltiger Preis (n, d >= 1) in der verlangten Richtung existiert.
 */
export function approximatePrice(N, D, mode) {
  if (N <= 0n || D <= 0n) return null;
  const MAX = PRICE_INT_MAX;
  let lp = 0n; let lq = 1n; // untere Schranke L = lp/lq <= N/D
  let up = 1n; let uq = 0n; // obere Schranke  U = up/uq >= N/D
  for (;;) {
    const mp = lp + up;
    const mq = lq + uq;
    if (mp > MAX || mq > MAX) break;
    const c = cmpFrac(mp, mq, N, D);
    if (c === 0) return { n: Number(mp), d: Number(mq) };
    if (c < 0) {
      // Mediant liegt unterhalb: L so weit wie moeglich Richtung U schieben.
      let k = (N * lq - lp * D) / (up * D - N * uq);
      if (up > 0n) k = k < (MAX - lp) / up ? k : (MAX - lp) / up;
      if (uq > 0n) k = k < (MAX - lq) / uq ? k : (MAX - lq) / uq;
      lp += k * up; lq += k * uq;
      if (cmpFrac(lp, lq, N, D) === 0) return { n: Number(lp), d: Number(lq) };
    } else {
      let k = (up * D - N * uq) / (N * lq - lp * D);
      if (lp > 0n) k = k < (MAX - up) / lp ? k : (MAX - up) / lp;
      k = k < (MAX - uq) / lq ? k : (MAX - uq) / lq;
      up += k * lp; uq += k * lq;
      if (cmpFrac(up, uq, N, D) === 0) return { n: Number(up), d: Number(uq) };
    }
  }
  if (mode === 'floor') return lp >= 1n ? { n: Number(lp), d: Number(lq) } : null;
  return uq >= 1n ? { n: Number(up), d: Number(uq) } : null;
}

/** true, wenn amountA/amountB in [minPrice, maxPrice] liegt (wie stellar-core prueft). */
export function priceWithinBounds(amountA, amountB, minPrice, maxPrice) {
  if (amountB <= 0n || !minPrice || !maxPrice) return false;
  const minOk = amountA * BigInt(minPrice.d) >= amountB * BigInt(minPrice.n);
  const maxOk = amountA * BigInt(maxPrice.d) <= amountB * BigInt(maxPrice.n);
  return minOk && maxOk;
}

/**
 * Was stellar-core bei einem nicht leeren Pool aus maxAmountA/B macht:
 * shares = min(maxA*S/rA, maxB*S/rB) abgerundet, eingezahlt wird
 * ceil(shares*rX/S) je Seite.
 */
export function simulateDeposit(pool, maxAmountA, maxAmountB) {
  const S = pool.totalShares;
  if (S <= 0n || pool.reserveA <= 0n || pool.reserveB <= 0n) return { shares: 0n, amountA: 0n, amountB: 0n };
  const sharesA = (maxAmountA * S) / pool.reserveA;
  const sharesB = (maxAmountB * S) / pool.reserveB;
  const shares = sharesA < sharesB ? sharesA : sharesB;
  return {
    shares,
    amountA: ceilDiv(shares * pool.reserveA, S),
    amountB: ceilDiv(shares * pool.reserveB, S),
  };
}

/** Preisgrenzen p*(1-s) und p*(1+s) mit p = rA/rB, gerichtet gerundet. */
export function depositPriceBounds(pool, slippageBps) {
  const s = BigInt(clampSlippageBps(slippageBps));
  const minPrice = approximatePrice(pool.reserveA * (BPS - s), pool.reserveB * BPS, 'floor');
  const maxPrice = approximatePrice(pool.reserveA * (BPS + s), pool.reserveB * BPS, 'ceil');
  return { minPrice, maxPrice };
}

/** true, wenn der aktuelle Pool-Preis rA/rB in den bestaetigten Grenzen liegt. */
export function poolPriceWithin(pool, minPrice, maxPrice) {
  return priceWithinBounds(pool.reserveA, pool.reserveB, minPrice, maxPrice);
}

/**
 * Einzahlung fuer eine Seite berechnen. side 'A'|'B' bezieht sich auf die
 * kanonische Pool-Reihenfolge, amount ist Stroop-BigInt.
 * status: 'ok' | 'emptyPool' | 'amountTooSmall' | 'priceUnrepresentable'
 * amountTooSmall greift auch, wenn stellar-core durch Rundung bei sehr kleinen
 * Betraegen einen Preis ausserhalb der Grenzen sehen wuerde (op_bad_price).
 */
export function quoteDeposit({ pool, side, amount, slippageBps }) {
  const s = clampSlippageBps(slippageBps);
  const zero = { amountA: 0n, amountB: 0n, maxAmountA: 0n, maxAmountB: 0n, minPrice: null, maxPrice: null, expectedShares: 0n, slippageBps: s };
  if (!pool || pool.totalShares <= 0n || pool.reserveA <= 0n || pool.reserveB <= 0n) return { ...zero, status: 'emptyPool' };
  const input = typeof amount === 'bigint' ? amount : 0n;
  if (input <= 0n) return { ...zero, status: 'amountTooSmall' };
  const amountA = side === 'B' ? ceilDiv(input * pool.reserveA, pool.reserveB) : input;
  const amountB = side === 'B' ? input : ceilDiv(input * pool.reserveB, pool.reserveA);
  const S = pool.totalShares;
  const sharesA = (amountA * S) / pool.reserveA;
  const sharesB = (amountB * S) / pool.reserveB;
  const expectedShares = sharesA < sharesB ? sharesA : sharesB;
  const { minPrice, maxPrice } = depositPriceBounds(pool, s);
  const base = { amountA, amountB, maxAmountA: amountA, maxAmountB: amountB, minPrice, maxPrice, expectedShares, slippageBps: s };
  if (!minPrice || !maxPrice) return { ...base, status: 'priceUnrepresentable' };
  if (amountA <= 0n || amountB <= 0n || expectedShares <= 0n) return { ...base, status: 'amountTooSmall' };
  const sim = simulateDeposit(pool, amountA, amountB);
  if (!priceWithinBounds(sim.amountA, sim.amountB, minPrice, maxPrice)) return { ...base, status: 'amountTooSmall' };
  return { ...base, status: 'ok' };
}

/**
 * Abhebung berechnen: amountX = floor(shares*rX/S), minAmountX =
 * floor(amountX*(10000-s)/10000). status: 'ok' | 'emptyPool' |
 * 'amountTooSmall' | 'exceedsPool'.
 */
export function quoteWithdraw({ pool, shares, slippageBps }) {
  const s = clampSlippageBps(slippageBps);
  const zero = { amountA: 0n, amountB: 0n, minAmountA: 0n, minAmountB: 0n, slippageBps: s };
  if (!pool || pool.totalShares <= 0n) return { ...zero, status: 'emptyPool' };
  const n = typeof shares === 'bigint' ? shares : 0n;
  if (n <= 0n) return { ...zero, status: 'amountTooSmall' };
  if (n > pool.totalShares) return { ...zero, status: 'exceedsPool' };
  const amountA = (n * pool.reserveA) / pool.totalShares;
  const amountB = (n * pool.reserveB) / pool.totalShares;
  const sb = BigInt(s);
  const minAmountA = (amountA * (BPS - sb)) / BPS;
  const minAmountB = (amountB * (BPS - sb)) / BPS;
  const status = amountA <= 0n && amountB <= 0n ? 'amountTooSmall' : 'ok';
  return { amountA, amountB, minAmountA, minAmountB, slippageBps: s, status };
}
