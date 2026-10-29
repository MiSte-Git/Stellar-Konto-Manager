import { describe, expect, it, vi } from 'vitest';
import { Account, Asset, Keypair, LiquidityPoolAsset, LiquidityPoolFeeV18, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  collectLiquidityPoolIds,
  evaluateLiquidityOperation,
  exactDepositPrices,
  hasLiquidityPoolOps,
  poolAssetsFromChangeTrust,
  resolveLiquidityPoolInfo,
} from '../liquidityPoolInfo.js';
import { poolIdFor, toStroops } from '../../stellar/liquidityPools.js';

const issuer = Keypair.random().publicKey();
const usd = new Asset('USD', issuer);
const eur = new Asset('EUR', issuer);
const POOL_ID = poolIdFor(Asset.native(), usd);
const OTHER_POOL_ID = poolIdFor(Asset.native(), eur);

function buildTx(ops) {
  const builder = new TransactionBuilder(new Account(Keypair.random().publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  // wie im Job-Detail: aus dem XDR dekodiert
  return TransactionBuilder.fromXDR(builder.setTimeout(60).build().toXDR(), Networks.TESTNET);
}

const deposit = (poolId = POOL_ID, minPrice = { n: 95, d: 10 }, maxPrice = { n: 105, d: 10 }) => Operation.liquidityPoolDeposit({
  liquidityPoolId: poolId, maxAmountA: '10', maxAmountB: '1', minPrice, maxPrice,
});
const withdraw = (poolId = POOL_ID) => Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '30', minAmountA: '99.5', minAmountB: '9.95' });
const poolTrust = (asset = usd) => Operation.changeTrust({ asset: new LiquidityPoolAsset(Asset.native(), asset, LiquidityPoolFeeV18) });

const record = (id = POOL_ID, rA = '1000.0000000', rB = '100.0000000', code = 'USD') => ({
  id,
  fee_bp: 30,
  total_trustlines: '3',
  total_shares: '300.0000000',
  reserves: [{ asset: 'native', amount: rA }, { asset: `${code}:${issuer}`, amount: rB }],
});

function serverWith(call) {
  return { liquidityPools: () => ({ liquidityPoolId: (id) => ({ call: () => call(id) }) }) };
}

describe('Pool-IDs und Quelle 1 (changeTrust)', () => {
  it('sammelt Pool-IDs der LP-Operationen ohne Duplikate', () => {
    const tx = buildTx([deposit(), withdraw(), deposit(OTHER_POOL_ID)]);
    expect(hasLiquidityPoolOps(tx.operations)).toBe(true);
    expect(collectLiquidityPoolIds(tx.operations)).toEqual([POOL_ID, OTHER_POOL_ID]);
    expect(hasLiquidityPoolOps(buildTx([Operation.bumpSequence({ bumpTo: '5' })]).operations)).toBe(false);
  });

  it('nimmt Assets aus changeTrust(LiquidityPoolAsset) nur bei passender Pool-ID', () => {
    const tx = buildTx([poolTrust(usd), poolTrust(eur), deposit(POOL_ID)]);
    const info = poolAssetsFromChangeTrust(tx.operations, [POOL_ID]);
    expect(Object.keys(info)).toEqual([POOL_ID]);
    expect(info[POOL_ID].assetA.isNative()).toBe(true);
    expect(info[POOL_ID].assetB.equals(usd)).toBe(true);
  });
});

describe('exactDepositPrices', () => {
  it('liest exakte Preisbrueche aus dem XDR je Operations-Index', () => {
    const tx = buildTx([poolTrust(), deposit(POOL_ID, { n: 1, d: 3 }, { n: 2, d: 3 })]);
    expect(tx.operations[1].minPrice).not.toBe('1/3');
    expect(exactDepositPrices(tx)).toEqual({ 1: { minPrice: { n: 1, d: 3 }, maxPrice: { n: 2, d: 3 } } });
  });
});

describe('resolveLiquidityPoolInfo', () => {
  it('nutzt changeTrust als Quelle und laedt den Pool-Stand trotzdem aus Horizon', async () => {
    const call = vi.fn(async (id) => record(id));
    const tx = buildTx([poolTrust(), deposit()]);
    const info = await resolveLiquidityPoolInfo({ operations: tx.operations, server: serverWith(call) });
    expect(info[POOL_ID]).toMatchObject({ source: 'changeTrust', error: '' });
    expect(info[POOL_ID].pool.reserveA).toBe(toStroops('1000'));
    expect(call).toHaveBeenCalledWith(POOL_ID);
  });

  it('behaelt die Assets aus changeTrust, wenn Horizon den Pool nicht liefert (404)', async () => {
    const tx = buildTx([poolTrust(), deposit()]);
    const info = await resolveLiquidityPoolInfo({
      operations: tx.operations,
      server: serverWith(async () => { throw Object.assign(new Error('Not Found'), { response: { status: 404 } }); }),
    });
    expect(info[POOL_ID]).toMatchObject({ source: 'changeTrust', pool: null, error: 'notFound' });
    expect(info[POOL_ID].assetB.equals(usd)).toBe(true);
  });

  it('nimmt ohne changeTrust die Assets aus Horizon', async () => {
    const tx = buildTx([withdraw()]);
    const info = await resolveLiquidityPoolInfo({ operations: tx.operations, server: serverWith(async (id) => record(id)) });
    expect(info[POOL_ID].source).toBe('horizon');
    expect(info[POOL_ID].assetB.equals(usd)).toBe(true);
  });

  it('laesst den Pool weg, wenn Horizon ihn nicht liefert oder die ID nicht zu den Assets passt', async () => {
    const tx = buildTx([withdraw()]);
    const notFound = await resolveLiquidityPoolInfo({
      operations: tx.operations,
      server: serverWith(async () => { throw Object.assign(new Error('Not Found'), { response: { status: 404 } }); }),
    });
    expect(notFound).toEqual({});
    // Horizon liefert unter der ID einen Record mit anderen Assets
    const mismatch = await resolveLiquidityPoolInfo({ operations: tx.operations, server: serverWith(async () => record(POOL_ID, '1', '1', 'EUR')) });
    expect(mismatch).toEqual({});
  });
});

describe('evaluateLiquidityOperation', () => {
  const pool = (rA, rB) => ({ assetA: Asset.native(), assetB: usd, reserveA: toStroops(rA), reserveB: toStroops(rB), totalShares: toStroops('300') });

  it('Deposit: Kurs innerhalb und ausserhalb der Grenzen (Pruefung wie stellar-core)', () => {
    const tx = buildTx([deposit()]);
    const prices = exactDepositPrices(tx)[0];
    const inside = evaluateLiquidityOperation(tx.operations[0], pool('1000', '100'), prices);
    expect(inside).toEqual({ kind: 'deposit', currentPrice: { n: 10000000000, d: 1000000000 }, withinBounds: true });
    const outside = evaluateLiquidityOperation(tx.operations[0], pool('1100', '90'), prices);
    expect(outside.withinBounds).toBe(false);
  });

  it('Withdraw: aktuelle Betraege gegen Mindestbetraege', () => {
    const tx = buildTx([withdraw()]);
    const ok = evaluateLiquidityOperation(tx.operations[0], pool('1000', '100'), undefined);
    expect(ok).toEqual({ kind: 'withdraw', amountA: toStroops('100'), amountB: toStroops('10'), meetsMinimum: true });
    const below = evaluateLiquidityOperation(tx.operations[0], pool('900', '111'), undefined);
    expect(below.meetsMinimum).toBe(false);
  });

  it('liefert null ohne Pool oder ohne exakte Preise', () => {
    const tx = buildTx([deposit()]);
    expect(evaluateLiquidityOperation(tx.operations[0], null, exactDepositPrices(tx)[0])).toBeNull();
    expect(evaluateLiquidityOperation(tx.operations[0], pool('1000', '100'), undefined)).toBeNull();
  });
});
