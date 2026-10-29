// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Account, Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { poolAssetFor, poolIdFor } from '../liquidityPools.js';
import {
  buildLiquidityDepositTransaction,
  buildLiquidityWithdrawTransaction,
  buildChangeTrustAndPathPaymentStrictSendTransaction,
  buildChangeTrustTransaction,
  buildManageSellOfferTransaction,
  buildPathPaymentStrictSendTransaction,
  signTransactionWithCollectedSigners,
} from '../tradingTransactions.js';

const TEST_KEYS = [
  {
    secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
    publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
  },
  {
    secret: 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO',
    publicKey: 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM',
  },
  {
    secret: 'SB555XN5SZZCKQXVGGJH656DHDOMWDJECNESCEDUAWLJPZ2PF2SXXLCU',
    publicKey: 'GBSDCVHW2TM6TK43OYJFDQOX7N4PIGG25YY73MP7XLJWJP7U4CZK2BYE',
  },
];

function makeAccount() {
  return new Account(TEST_KEYS[0].publicKey, '1');
}

describe('trading transaction builders', () => {
  it('builds a changeTrust transaction', () => {
    const issuer = TEST_KEYS[1].publicKey;
    const asset = new Asset('USDC', issuer);
    const tx = buildChangeTrustTransaction({
      account: makeAccount(),
      asset,
      limit: '1000',
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    const op = tx.operations[0];
    expect(op.type).toBe('changeTrust');
    expect(op.line.code).toBe('USDC');
    expect(op.line.issuer).toBe(issuer);
    expect(op.limit).toBe('1000.0000000');
  });

  it('builds a strict-send path payment transaction', () => {
    const issuer = TEST_KEYS[1].publicKey;
    const destination = TEST_KEYS[2].publicKey;
    const destAsset = new Asset('USDC', issuer);
    const tx = buildPathPaymentStrictSendTransaction({
      account: makeAccount(),
      sendAsset: Asset.native(),
      sendAmount: '10',
      destination,
      destAsset,
      destMin: '9.95',
      path: [],
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    const op = tx.operations[0];
    expect(op.type).toBe('pathPaymentStrictSend');
    expect(op.sendAsset.isNative()).toBe(true);
    expect(op.sendAmount).toBe('10.0000000');
    expect(op.destination).toBe(destination);
    expect(op.destAsset.code).toBe('USDC');
    expect(op.destMin).toBe('9.9500000');
  });

  it('builds a combined changeTrust and strict-send path payment transaction', () => {
    const issuer = TEST_KEYS[1].publicKey;
    const destination = TEST_KEYS[0].publicKey;
    const destAsset = new Asset('EURONE', issuer);
    const tx = buildChangeTrustAndPathPaymentStrictSendTransaction({
      account: makeAccount(),
      trustAsset: destAsset,
      trustLimit: '500',
      sendAsset: Asset.native(),
      sendAmount: '12',
      destination,
      destAsset,
      destMin: '11.5',
      path: [],
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    expect(tx.operations).toHaveLength(2);
    expect(tx.operations[0].type).toBe('changeTrust');
    expect(tx.operations[0].line.code).toBe('EURONE');
    expect(tx.operations[0].limit).toBe('500.0000000');
    expect(tx.operations[1].type).toBe('pathPaymentStrictSend');
    expect(tx.operations[1].destAsset.code).toBe('EURONE');
    expect(tx.operations[1].destMin).toBe('11.5000000');
  });

  it('builds a manageSellOffer transaction for creating and deleting offers', () => {
    const issuer = TEST_KEYS[1].publicKey;
    const token = new Asset('EURC', issuer);

    const createTx = buildManageSellOfferTransaction({
      account: makeAccount(),
      selling: token,
      buying: Asset.native(),
      amount: '25',
      price: '0.75',
      offerId: '0',
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    const createOp = createTx.operations[0];
    expect(createOp.type).toBe('manageSellOffer');
    expect(createOp.selling.code).toBe('EURC');
    expect(createOp.buying.isNative()).toBe(true);
    expect(createOp.amount).toBe('25.0000000');
    expect(createOp.price).toBe('0.75');
    expect(createOp.offerId).toBe('0');

    const deleteTx = buildManageSellOfferTransaction({
      account: makeAccount(),
      selling: token,
      buying: Asset.native(),
      amount: '0',
      price: '0.75',
      offerId: '123',
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    const deleteOp = deleteTx.operations[0];
    expect(deleteOp.type).toBe('manageSellOffer');
    expect(deleteOp.amount).toBe('0.0000000');
    expect(deleteOp.offerId).toBe('123');
  });

  it('signs with collected signers', () => {
    const signer = Keypair.fromSecret(TEST_KEYS[0].secret);
    const tx = buildManageSellOfferTransaction({
      account: new Account(signer.publicKey(), '1'),
      selling: Asset.native(),
      buying: new Asset('USDC', TEST_KEYS[1].publicKey),
      amount: '1',
      price: '0.5',
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });

    expect(tx.signatures).toHaveLength(0);
    signTransactionWithCollectedSigners(tx, [{ keypair: signer }]);
    expect(tx.signatures).toHaveLength(1);
  });
});

describe('liquidity pool builders', () => {
  const issuerA = TEST_KEYS[1].publicKey;
  const issuerB = TEST_KEYS[2].publicKey;
  const aqua = new Asset('AQUA', issuerA);
  const usdc = new Asset('USDC', issuerB);
  const xlm = Asset.native();
  const poolId = poolIdFor(aqua, usdc);
  const poolAsset = poolAssetFor(aqua, usdc);
  const base = {
    poolAsset,
    liquidityPoolId: poolId,
    maxAmountA: '10',
    maxAmountB: '2.5',
    minPrice: { n: 39, d: 10 },
    maxPrice: { n: 41, d: 10 },
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  };

  it('baut nur liquidityPoolDeposit, wenn alle Trustlines vorhanden sind', () => {
    const tx = buildLiquidityDepositTransaction({ ...base, account: makeAccount(), missingTrustAssets: [], needPoolTrust: false });
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolDeposit']);
    const [op] = tx.operations;
    expect(op.liquidityPoolId).toBe(poolId);
    expect(op.maxAmountA).toBe('10.0000000');
    expect(op.maxAmountB).toBe('2.5000000');
    expect(op.minPrice).toBe('3.9');
    expect(op.maxPrice).toBe('4.1');
    expect(tx.fee).toBe('100');
    expect(Number(tx.timeBounds.maxTime)).toBeGreaterThan(0);
  });

  it('stellt fehlende Asset-Trustlines und die Pool-Trustline in dieser Reihenfolge voran', () => {
    const tx = buildLiquidityDepositTransaction({ ...base, account: makeAccount(), missingTrustAssets: [aqua, usdc], needPoolTrust: true });
    expect(tx.operations.map((op) => op.type)).toEqual(['changeTrust', 'changeTrust', 'changeTrust', 'liquidityPoolDeposit']);
    expect(tx.operations[0].line.code).toBe('AQUA');
    expect(tx.operations[1].line.code).toBe('USDC');
    expect(tx.operations[2].line.getAssetType()).toBe('liquidity_pool_shares');
    expect(tx.fee).toBe('400');
  });

  it('deckt teilweise vorhandene Trustlines ab (nur B fehlt, nur Pool fehlt)', () => {
    const onlyB = buildLiquidityDepositTransaction({ ...base, account: makeAccount(), missingTrustAssets: [usdc], needPoolTrust: true });
    expect(onlyB.operations.map((op) => op.line?.code || op.line?.getAssetType?.() || op.type))
      .toEqual(['USDC', 'liquidity_pool_shares', 'liquidityPoolDeposit']);
    const onlyPool = buildLiquidityDepositTransaction({ ...base, account: makeAccount(), missingTrustAssets: [], needPoolTrust: true });
    expect(onlyPool.operations.map((op) => op.type)).toEqual(['changeTrust', 'liquidityPoolDeposit']);
  });

  it('lehnt eine Trustline fuer XLM ab', () => {
    expect(() => buildLiquidityDepositTransaction({ ...base, account: makeAccount(), missingTrustAssets: [xlm], needPoolTrust: false }))
      .toThrow('submitTransaction.failed:liquidity.invalidInput');
  });

  it('stellt fuer ein selbst ausgegebenes Asset nie changeTrust voran', () => {
    // Konto ist Issuer von AQUA
    const tx = buildLiquidityDepositTransaction({ ...base, account: new Account(issuerA, '1'), missingTrustAssets: [aqua, usdc], needPoolTrust: true });
    expect(tx.operations.map((op) => op.line?.code || op.line?.getAssetType?.() || op.type))
      .toEqual(['USDC', 'liquidity_pool_shares', 'liquidityPoolDeposit']);
  });

  it('respektiert timeoutSeconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const tx = buildLiquidityDepositTransaction({ ...base, account: makeAccount(), needPoolTrust: false, timeoutSeconds: 300 });
    expect(Number(tx.timeBounds.maxTime)).toBeGreaterThanOrEqual(before + 300);
  });

  const accountWithShares = (balance) => Object.assign(makeAccount(), {
    balances: [
      { asset_type: 'native', balance: '100' },
      { asset_type: 'liquidity_pool_shares', liquidity_pool_id: poolId, balance },
    ],
  });
  const withdrawBase = { liquidityPoolId: poolId, minAmountA: '1', minAmountB: '0.5', poolAsset, fee: '100', networkPassphrase: Networks.TESTNET };

  it('baut eine Teilabhebung ohne Trustline-Entfernung', () => {
    const tx = buildLiquidityWithdrawTransaction({ ...withdrawBase, account: accountWithShares('10.0000000'), amount: '4' });
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw']);
    expect(tx.operations[0]).toMatchObject({ liquidityPoolId: poolId, amount: '4.0000000', minAmountA: '1.0000000', minAmountB: '0.5000000' });
  });

  it('baut 100 % mit anschliessender Entfernung der Pool-Trustline', () => {
    const tx = buildLiquidityWithdrawTransaction({ ...withdrawBase, account: accountWithShares('10.0000000'), amount: '10', removePoolTrust: true });
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw', 'changeTrust']);
    expect(tx.operations[1].limit).toBe('0.0000000');
    expect(tx.operations[1].line.getAssetType()).toBe('liquidity_pool_shares');
  });

  it('baut 100 % auch ohne Entfernung', () => {
    const tx = buildLiquidityWithdrawTransaction({ ...withdrawBase, account: accountWithShares('10.0000000'), amount: '10', removePoolTrust: false });
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw']);
  });

  it('wirft bei Teilabhebung mit Trustline-Entfernung', () => {
    expect(() => buildLiquidityWithdrawTransaction({ ...withdrawBase, account: accountWithShares('10.0000000'), amount: '9.9999999', removePoolTrust: true }))
      .toThrow('submitTransaction.failed:liquidity.removeTrustPartial');
    expect(() => buildLiquidityWithdrawTransaction({ ...withdrawBase, account: makeAccount(), amount: '10', removePoolTrust: true }))
      .toThrow('submitTransaction.failed:liquidity.removeTrustPartial');
  });
});
