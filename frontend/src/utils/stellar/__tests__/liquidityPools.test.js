import { describe, expect, it } from 'vitest';
import { Asset } from '@stellar/stellar-sdk';
import { LiquidityPoolAsset } from '@stellar/stellar-sdk';
import {
  approximatePrice,
  clampSlippageBps,
  depositPriceBounds,
  poolAssetFor,
  poolPriceWithin,
  priceWithinBounds,
  PRICE_INT_MAX,
  quoteDeposit,
  quoteWithdraw,
  simulateDeposit,
  fromStroops,
  isValidPoolId,
  normalizeNativePool,
  parseHorizonPoolAsset,
  poolIdFor,
  poolSidesInOrder,
  positionFromBalance,
  sortPoolAssets,
  toStroops,
} from '../liquidityPools.js';

// Circle-USDC auf Mainnet; die Pool-ID XLM/USDC wurde vorab per SDK
// (getLiquidityPoolId, Fee 30) berechnet und ist fest eingetragen.
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const XLM_USDC_POOL_ID = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';
const xlm = Asset.native();
const usdc = new Asset('USDC', USDC_ISSUER);
const aqua = new Asset('AQUA', 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA');

describe('toStroops / fromStroops', () => {
  it('parst Horizon-Strings mit 7 Dezimalen exakt', () => {
    expect(toStroops('1000.0000000')).toBe(10_000_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('5')).toBe(50_000_000n);
    expect(toStroops('1.5')).toBe(15_000_000n);
  });

  it('schneidet mehr als 7 Nachkommastellen ab', () => {
    expect(toStroops('0.00000019')).toBe(1n);
  });

  it('verarbeitet sehr grosse Werte ohne Genauigkeitsverlust', () => {
    expect(toStroops('922337203685.4775807')).toBe(9223372036854775807n);
    expect(fromStroops(9223372036854775807n)).toBe('922337203685.4775807');
  });

  it('lehnt ungueltige Eingaben ab', () => {
    expect(() => toStroops('-1')).toThrow();
    expect(() => toStroops('1e5')).toThrow();
    expect(() => toStroops('')).toThrow();
  });

  it('formatiert immer mit 7 Nachkommastellen', () => {
    expect(fromStroops(0n)).toBe('0.0000000');
    expect(fromStroops(1n)).toBe('0.0000001');
    expect(fromStroops(12_345_678_901n)).toBe('1234.5678901');
  });
});

describe('sortPoolAssets', () => {
  it('laesst kanonische Reihenfolge unveraendert (XLM als A)', () => {
    const r = sortPoolAssets(xlm, usdc);
    expect(r.assetA.isNative()).toBe(true);
    expect(r.assetB.equals(usdc)).toBe(true);
    expect(r.swapped).toBe(false);
  });

  it('tauscht, wenn XLM als B uebergeben wird', () => {
    const r = sortPoolAssets(usdc, xlm);
    expect(r.assetA.isNative()).toBe(true);
    expect(r.assetB.equals(usdc)).toBe(true);
    expect(r.swapped).toBe(true);
  });

  it('sortiert zwei Tokens kanonisch (alphanum4 nach Code)', () => {
    expect(sortPoolAssets(usdc, aqua)).toMatchObject({ assetA: aqua, assetB: usdc, swapped: true });
    expect(sortPoolAssets(aqua, usdc)).toMatchObject({ assetA: aqua, assetB: usdc, swapped: false });
  });

  it('wirft bei identischen Assets', () => {
    expect(() => sortPoolAssets(usdc, new Asset('USDC', USDC_ISSUER))).toThrow();
  });
});

describe('poolIdFor', () => {
  it('liefert die bekannte Pool-ID unabhaengig von der Eingabereihenfolge', () => {
    expect(poolIdFor(xlm, usdc)).toBe(XLM_USDC_POOL_ID);
    expect(poolIdFor(usdc, xlm)).toBe(XLM_USDC_POOL_ID);
    expect(isValidPoolId(poolIdFor(aqua, usdc))).toBe(true);
  });
});

describe('isValidPoolId', () => {
  it('akzeptiert nur 64 kleine Hex-Zeichen', () => {
    expect(isValidPoolId(XLM_USDC_POOL_ID)).toBe(true);
    expect(isValidPoolId(XLM_USDC_POOL_ID.toUpperCase())).toBe(false);
    expect(isValidPoolId(XLM_USDC_POOL_ID.slice(1))).toBe(false);
    expect(isValidPoolId(`${XLM_USDC_POOL_ID.slice(1)}g`)).toBe(false);
    expect(isValidPoolId('')).toBe(false);
    expect(isValidPoolId(null)).toBe(false);
  });
});

describe('parseHorizonPoolAsset', () => {
  it('parst native und CODE:ISSUER', () => {
    expect(parseHorizonPoolAsset('native').isNative()).toBe(true);
    expect(parseHorizonPoolAsset(`USDC:${USDC_ISSUER}`).equals(usdc)).toBe(true);
  });

  it('wirft bei ungueltigem Format', () => {
    expect(() => parseHorizonPoolAsset('USDC')).toThrow();
    expect(() => parseHorizonPoolAsset(`:${USDC_ISSUER}`)).toThrow();
    expect(() => parseHorizonPoolAsset(`A:B:C`)).toThrow();
  });
});

describe('normalizeNativePool', () => {
  const record = {
    id: XLM_USDC_POOL_ID,
    fee_bp: 30,
    type: 'constant_product',
    total_trustlines: '1234',
    total_shares: '5000.0000000',
    reserves: [
      { asset: 'native', amount: '1000.0000000' },
      { asset: `USDC:${USDC_ISSUER}`, amount: '250.5000000' },
    ],
  };

  it('liefert das einheitliche Modell mit BigInt-Betraegen', () => {
    const pool = normalizeNativePool(record);
    expect(pool).toMatchObject({
      source: 'native',
      poolId: XLM_USDC_POOL_ID,
      reserveA: 10_000_000_000n,
      reserveB: 2_505_000_000n,
      totalShares: 50_000_000_000n,
      feeBps: 30,
      totalTrustlines: 1234,
    });
    expect(pool.assetA.isNative()).toBe(true);
    expect(pool.assetB.equals(usdc)).toBe(true);
  });

  it('ordnet Reserven ueber das Asset zu, nicht ueber die Array-Position', () => {
    const pool = normalizeNativePool({ ...record, reserves: [...record.reserves].reverse() });
    expect(pool.assetA.isNative()).toBe(true);
    expect(pool.reserveA).toBe(10_000_000_000n);
    expect(pool.reserveB).toBe(2_505_000_000n);
  });

  it('wirft bei unvollstaendigem Record', () => {
    expect(() => normalizeNativePool({ id: 'x', reserves: [] })).toThrow();
  });

  it('wirft poolIdMismatch, wenn record.id nicht zu den Assets passt', () => {
    expect(() => normalizeNativePool({ ...record, id: 'b'.repeat(64) })).toThrow('liquidityPools.poolIdMismatch');
    expect(() => normalizeNativePool({ ...record, id: undefined })).toThrow('liquidityPools.poolIdMismatch');
  });

  it('prueft optional gegen die angefragte Pool-ID', () => {
    expect(normalizeNativePool(record, XLM_USDC_POOL_ID).poolId).toBe(XLM_USDC_POOL_ID);
    expect(() => normalizeNativePool(record, 'b'.repeat(64))).toThrow('liquidityPools.poolIdMismatch');
  });
});

describe('positionFromBalance', () => {
  const pool = {
    source: 'native',
    poolId: XLM_USDC_POOL_ID,
    reserveA: toStroops('1000'),
    reserveB: toStroops('333'),
    totalShares: toStroops('3'),
  };

  it('berechnet Gegenwert und Anteil, abgerundet auf Stroops', () => {
    const pos = positionFromBalance({ liquidity_pool_id: XLM_USDC_POOL_ID, balance: '1.0000000' }, pool);
    expect(pos.source).toBe('native');
    expect(pos.poolId).toBe(XLM_USDC_POOL_ID);
    expect(pos.shares).toBe(10_000_000n);
    // 1000/3 = 333.33333333... -> abgerundet
    expect(fromStroops(pos.amountA)).toBe('333.3333333');
    expect(fromStroops(pos.amountB)).toBe('111.0000000');
    expect(pos.sharePercent).toBeCloseTo(33.333333, 6);
  });

  it('liefert 0 fuer eine Trustline ohne Shares', () => {
    const pos = positionFromBalance({ liquidity_pool_id: XLM_USDC_POOL_ID, balance: '0.0000000' }, pool);
    expect(pos.shares).toBe(0n);
    expect(pos.amountA).toBe(0n);
    expect(pos.amountB).toBe(0n);
    expect(pos.sharePercent).toBe(0);
  });

  it('behandelt totalShares = 0 ohne Division durch null', () => {
    const empty = { ...pool, reserveA: 0n, reserveB: 0n, totalShares: 0n };
    const pos = positionFromBalance({ liquidity_pool_id: XLM_USDC_POOL_ID, balance: '0' }, empty);
    expect(pos).toMatchObject({ shares: 0n, amountA: 0n, amountB: 0n, sharePercent: 0 });
  });

  it('rechnet mit sehr grossen Reserven exakt', () => {
    const big = { ...pool, reserveA: toStroops('900000000000'), reserveB: toStroops('1'), totalShares: toStroops('900000000000') };
    const pos = positionFromBalance({ liquidity_pool_id: XLM_USDC_POOL_ID, balance: '450000000000.0000001' }, big);
    expect(fromStroops(pos.amountA)).toBe('450000000000.0000001');
    expect(fromStroops(pos.amountB)).toBe('0.5000000');
    expect(pos.sharePercent).toBe(50);
  });
});

describe('poolSidesInOrder', () => {
  const pool = { assetA: xlm, assetB: usdc, reserveA: 10n, reserveB: 20n };

  it('zeigt die Nutzerreihenfolge, auch wenn sie nicht kanonisch ist', () => {
    const [first, second] = poolSidesInOrder(pool, usdc);
    expect(first).toEqual({ asset: usdc, reserve: 20n });
    expect(second).toEqual({ asset: xlm, reserve: 10n });
  });

  it('bleibt kanonisch ohne oder mit fremdem Asset', () => {
    expect(poolSidesInOrder(pool)[0].asset.isNative()).toBe(true);
    expect(poolSidesInOrder(pool, xlm)[0].asset.isNative()).toBe(true);
    expect(poolSidesInOrder(pool, aqua)[0].asset.isNative()).toBe(true);
  });
});

const MAX = PRICE_INT_MAX;
const mkPool = (rA, rB, S) => ({ source: 'native', poolId: XLM_USDC_POOL_ID, assetA: xlm, assetB: usdc, reserveA: toStroops(rA), reserveB: toStroops(rB), totalShares: toStroops(S) });
// p = n/d mit N/D vergleichen, ohne Float
const le = (p, N, D) => BigInt(p.n) * D <= N * BigInt(p.d);
const ge = (p, N, D) => BigInt(p.n) * D >= N * BigInt(p.d);
const inRange = (p) => p.n >= 1 && p.d >= 1 && BigInt(p.n) <= MAX && BigInt(p.d) <= MAX;

describe('clampSlippageBps', () => {
  it('begrenzt auf 10..500 und nutzt sonst 50', () => {
    expect(clampSlippageBps(50)).toBe(50);
    expect(clampSlippageBps(1)).toBe(10);
    expect(clampSlippageBps(0)).toBe(10);
    expect(clampSlippageBps(9999)).toBe(500);
    expect(clampSlippageBps('120')).toBe(120);
    expect(clampSlippageBps(12.6)).toBe(13);
    expect(clampSlippageBps('abc')).toBe(50);
    expect(clampSlippageBps(undefined)).toBe(50);
    expect(clampSlippageBps('')).toBe(50);
  });
});

describe('poolAssetFor', () => {
  it('liefert das kanonische LiquidityPoolAsset in beiden Eingabereihenfolgen', () => {
    const a = poolAssetFor(usdc, xlm);
    expect(a).toBeInstanceOf(LiquidityPoolAsset);
    expect(a.assetA.isNative()).toBe(true);
    expect(a.equals(poolAssetFor(xlm, usdc))).toBe(true);
    expect(a.fee).toBe(30);
  });
});

describe('approximatePrice', () => {
  it('liefert darstellbare Brueche exakt', () => {
    expect(approximatePrice(21n, 10n, 'floor')).toEqual({ n: 21, d: 10 });
    expect(approximatePrice(42n, 20n, 'ceil')).toEqual({ n: 21, d: 10 });
    expect(approximatePrice(MAX, 1n, 'ceil')).toEqual({ n: Number(MAX), d: 1 });
  });

  it('rundet floor nur ab und ceil nur auf, mit int32-Grenzen', () => {
    const cases = [
      [10n ** 20n + 7n, 3n * 10n ** 13n],     // ~3.3e6
      [1n, 3n * 10n ** 7n + 1n],              // ~3.3e-8
      [123456789012345n, 987654321098n],      // ~125
      [10n ** 18n + 1n, 10n ** 18n],          // knapp ueber 1
      [7n * 10n ** 15n, 10n ** 22n],          // 7e-7
      [10n ** 15n, 7n],                       // ~1.4e14 > int32
    ];
    for (const [N, D] of cases) {
      const lo = approximatePrice(N, D, 'floor');
      const hi = approximatePrice(N, D, 'ceil');
      if (lo) { expect(inRange(lo)).toBe(true); expect(le(lo, N, D)).toBe(true); }
      if (hi) { expect(inRange(hi)).toBe(true); expect(ge(hi, N, D)).toBe(true); }
    }
  });

  it('ist eng: zwischen floor und ceil liegt kein besserer Bruch mit kleinem Nenner', () => {
    const N = 10n ** 20n + 7n; const D = 3n * 10n ** 13n;
    const lo = approximatePrice(N, D, 'floor');
    const hi = approximatePrice(N, D, 'ceil');
    // Nachbarn im Stern-Brocot-Baum: hi.n*lo.d - lo.n*hi.d == 1
    expect(BigInt(hi.n) * BigInt(lo.d) - BigInt(lo.n) * BigInt(hi.d)).toBe(1n);
  });

  it('liefert null, wenn in der Richtung kein gueltiger Preis existiert', () => {
    expect(approximatePrice(1n, 10n ** 12n, 'floor')).toBeNull(); // < 1/int32max
    expect(approximatePrice(1n, 10n ** 12n, 'ceil')).toEqual({ n: 1, d: Number(MAX) });
    expect(approximatePrice(10n ** 12n, 1n, 'ceil')).toBeNull(); // > int32max
    expect(approximatePrice(10n ** 12n, 1n, 'floor')).toEqual({ n: Number(MAX), d: 1 });
    expect(approximatePrice(0n, 1n, 'floor')).toBeNull();
  });

  it('haelt die Richtung auch bei vielen Zufallswerten ein', () => {
    let seed = 12345n;
    const rnd = () => { seed = (seed * 6364136223846793005n + 1442695040888963407n) % (2n ** 64n); return seed; };
    for (let i = 0; i < 300; i += 1) {
      const N = (rnd() % (10n ** 18n)) + 1n;
      const D = (rnd() % (10n ** 18n)) + 1n;
      const lo = approximatePrice(N, D, 'floor');
      const hi = approximatePrice(N, D, 'ceil');
      if (lo) expect(inRange(lo) && le(lo, N, D)).toBe(true);
      if (hi) expect(inRange(hi) && ge(hi, N, D)).toBe(true);
    }
  });
});

describe('depositPriceBounds', () => {
  it.each([
    ['ausgewogen', '1000', '250'],
    ['p < 1e-6', '1', '5000000'],            // p = 2e-7
    ['p ~ 2e-10 (nicht darstellbar)', '0.0001', '500000'],
    ['p ~ 1e-6', '1', '1000000'],
    ['p > 1e6', '50000000', '0.5'],
    ['krumme Werte', '123456.7890123', '0.0000007'],
  ])('p liegt in [min, max] (%s)', (_name, rA, rB) => {
    const pool = mkPool(rA, rB, '100');
    const { minPrice, maxPrice } = depositPriceBounds(pool, 50);
    if (!minPrice || !maxPrice) {
      expect(quoteDeposit({ pool, side: 'A', amount: toStroops('1'), slippageBps: 50 }).status).toBe('priceUnrepresentable');
      return;
    }
    expect(inRange(minPrice) && inRange(maxPrice)).toBe(true);
    expect(poolPriceWithin(pool, minPrice, maxPrice)).toBe(true);
    // min <= p*(1-s) und max >= p*(1+s)
    expect(le(minPrice, pool.reserveA * 9950n, pool.reserveB * 10000n)).toBe(true);
    expect(ge(maxPrice, pool.reserveA * 10050n, pool.reserveB * 10000n)).toBe(true);
  });

  it('meldet einen nicht darstellbaren Preis statt still zu runden', () => {
    const pool = mkPool('0.0000001', '900000000', '1'); // p ~ 1.1e-16
    expect(depositPriceBounds(pool, 50).minPrice).toBeNull();
    expect(quoteDeposit({ pool, side: 'B', amount: toStroops('1'), slippageBps: 50 }).status).toBe('priceUnrepresentable');
  });
});

describe('quoteDeposit', () => {
  const pool = mkPool('1000', '300', '500'); // p = 10/3

  it('berechnet die Gegenseite aufgerundet (Eingabe A)', () => {
    const q = quoteDeposit({ pool, side: 'A', amount: toStroops('1'), slippageBps: 50 });
    expect(q.status).toBe('ok');
    expect(fromStroops(q.amountA)).toBe('1.0000000');
    expect(fromStroops(q.amountB)).toBe('0.3000000');
    expect(q.maxAmountA).toBe(q.amountA);
    expect(q.maxAmountB).toBe(q.amountB);
    expect(fromStroops(q.expectedShares)).toBe('0.5000000');
  });

  it('berechnet die Gegenseite aufgerundet (Eingabe B)', () => {
    const q = quoteDeposit({ pool, side: 'B', amount: toStroops('1'), slippageBps: 50 });
    // 1 * 1000/300 = 3.33333333.. -> aufgerundet
    expect(fromStroops(q.amountA)).toBe('3.3333334');
    expect(fromStroops(q.amountB)).toBe('1.0000000');
    // min(3.3333334*500/1000, 1*500/300) = min(1.6666667, 1.6666666) -> abgerundet
    expect(fromStroops(q.expectedShares)).toBe('1.6666666');
    expect(q.status).toBe('ok');
  });

  it('setzt Preisgrenzen um p = rA/rB mit der Slippage', () => {
    const q = quoteDeposit({ pool, side: 'A', amount: toStroops('10'), slippageBps: 100 });
    // p = 10/3; min = 10/3 * 0.99 = 3.3, max = 10/3 * 1.01 = 3.3666...
    expect(q.minPrice).toEqual({ n: 33, d: 10 });
    expect(q.maxPrice).toEqual({ n: 101, d: 30 });
    expect(q.slippageBps).toBe(100);
  });

  it('meldet leere Pools', () => {
    const empty = { ...pool, reserveA: 0n, reserveB: 0n, totalShares: 0n };
    expect(quoteDeposit({ pool: empty, side: 'A', amount: 1n, slippageBps: 50 }).status).toBe('emptyPool');
  });

  it('meldet zu kleine Betraege (1 Stroop, Gegenseite oder Shares 0)', () => {
    expect(quoteDeposit({ pool, side: 'A', amount: 0n, slippageBps: 50 }).status).toBe('amountTooSmall');
    // 1 Stroop A -> Shares floor(1*500/1000) = 0
    const q = quoteDeposit({ pool, side: 'A', amount: 1n, slippageBps: 50 });
    expect(q.expectedShares).toBe(0n);
    expect(q.status).toBe('amountTooSmall');
    // Gegenseite 0 bei extrem unausgewogenem Pool ist durch Aufrunden ausgeschlossen
    const lopsided = mkPool('100', '0.0000010', '1'); // p = 1e8
    const q2 = quoteDeposit({ pool: lopsided, side: 'A', amount: 1n, slippageBps: 50 });
    expect(q2.amountB).toBe(1n);
    expect(q2.status).toBe('amountTooSmall');
  });

  it('meldet amountTooSmall, wenn stellar-core durch Rundung einen Preis ausserhalb sehen wuerde', () => {
    const p = mkPool('3', '1', '1');
    // 7 Stroops A -> B = ceil(7/3) = 3; shares = min(7*1/3, 3*1/1)=2; core zahlt ceil(2*3)=6 A, 2 B -> 3.0 ok
    const q = quoteDeposit({ pool: p, side: 'A', amount: 7n, slippageBps: 10 });
    const sim = simulateDeposit(p, q.maxAmountA, q.maxAmountB);
    expect(priceWithinBounds(sim.amountA, sim.amountB, q.minPrice, q.maxPrice)).toBe(q.status === 'ok');
  });

  it('funktioniert bei sehr grossen Reserven ohne Genauigkeitsverlust', () => {
    const big = mkPool('900000000000', '450000000000', '600000000000');
    const q = quoteDeposit({ pool: big, side: 'A', amount: toStroops('900000000000'), slippageBps: 50 });
    expect(fromStroops(q.amountB)).toBe('450000000000.0000000');
    expect(fromStroops(q.expectedShares)).toBe('600000000000.0000000');
    expect(q.status).toBe('ok');
  });
});

describe('simulateDeposit', () => {
  it('rechnet wie stellar-core (Shares abgerundet, Betraege aufgerundet)', () => {
    const pool = mkPool('1000', '300', '500');
    const sim = simulateDeposit(pool, toStroops('3.3333334'), toStroops('1'));
    expect(fromStroops(sim.shares)).toBe('1.6666666');
    expect(fromStroops(sim.amountA)).toBe('3.3333332');
    expect(fromStroops(sim.amountB)).toBe('1.0000000');
  });
});

describe('quoteWithdraw', () => {
  const pool = mkPool('1000', '300', '3');

  it('rundet Betraege und Mindestbetraege ab', () => {
    const q = quoteWithdraw({ pool, shares: toStroops('1'), slippageBps: 50 });
    expect(q.status).toBe('ok');
    expect(fromStroops(q.amountA)).toBe('333.3333333');
    expect(fromStroops(q.amountB)).toBe('100.0000000');
    // 333.3333333 * 0.995 = 331.66666663... -> abgerundet
    expect(fromStroops(q.minAmountA)).toBe('331.6666666');
    expect(fromStroops(q.minAmountB)).toBe('99.5000000');
  });

  it('liefert bei 100 % aller Shares genau die Reserven', () => {
    const q = quoteWithdraw({ pool, shares: pool.totalShares, slippageBps: 10 });
    expect(q.amountA).toBe(pool.reserveA);
    expect(q.amountB).toBe(pool.reserveB);
  });

  it('behandelt leere Pools, 0 Shares, zu viele Shares und Kleinstbetraege', () => {
    expect(quoteWithdraw({ pool: { ...pool, totalShares: 0n }, shares: 1n, slippageBps: 50 }).status).toBe('emptyPool');
    expect(quoteWithdraw({ pool, shares: 0n, slippageBps: 50 }).status).toBe('amountTooSmall');
    expect(quoteWithdraw({ pool, shares: pool.totalShares + 1n, slippageBps: 50 }).status).toBe('exceedsPool');
    const tiny = mkPool('0.0000001', '0.0000001', '1');
    expect(quoteWithdraw({ pool: tiny, shares: 1n, slippageBps: 50 }).status).toBe('amountTooSmall');
  });
});
