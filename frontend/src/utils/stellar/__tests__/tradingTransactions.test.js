// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Account, Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import {
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
