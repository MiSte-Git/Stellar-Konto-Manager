import { describe, expect, it } from 'vitest';
import { Asset } from '@stellar/stellar-sdk';
import {
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
