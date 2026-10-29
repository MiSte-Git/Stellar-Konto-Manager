import { Account, Asset, Keypair, LiquidityPoolAsset, LiquidityPoolFeeV18, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { poolIdFor } from '../../../utils/stellar/liquidityPools.js';
import { describe, expect, it } from 'vitest';
import { parseSlippagePercent, sharesFromPercent } from '../dialogInputs.js';
import { LIQUIDITY_OP_CODES, jobSubmitResultCodes, liquidityErrorKey, liquidityErrorKeyFromResultCodes } from '../../../utils/stellar/liquidityErrors.js';
import errors from '../../../locales/de/errors.json';

describe('parseSlippagePercent', () => {
  it('rechnet Prozent exakt in Basispunkte um (ohne Float)', () => {
    expect(parseSlippagePercent('0.5')).toEqual({ valid: true, bps: 50 });
    expect(parseSlippagePercent('0,1')).toEqual({ valid: true, bps: 10 });
    expect(parseSlippagePercent('5')).toEqual({ valid: true, bps: 500 });
    expect(parseSlippagePercent('1.25')).toEqual({ valid: true, bps: 125 });
  });

  it('meldet Werte ausserhalb 0,1..5 % und ungueltige Eingaben, statt still zu korrigieren', () => {
    expect(parseSlippagePercent('0.09').valid).toBe(false);
    expect(parseSlippagePercent('5.01').valid).toBe(false);
    expect(parseSlippagePercent('1.234').valid).toBe(false);
    expect(parseSlippagePercent('-1').valid).toBe(false);
    expect(parseSlippagePercent('').valid).toBe(false);
  });
});

describe('sharesFromPercent', () => {
  it('rundet ab und liefert bei 100 % exakt den Bestand', () => {
    expect(sharesFromPercent(10n, '33')).toBe(3n);
    expect(sharesFromPercent(300000000n, '25')).toBe(75000000n);
    expect(sharesFromPercent(7n, '100')).toBe(7n);
    expect(sharesFromPercent(1000n, '12,34')).toBe(123n);
  });

  it('lehnt 0, ueber 100 und Unsinn ab', () => {
    expect(sharesFromPercent(10n, '0')).toBeNull();
    expect(sharesFromPercent(10n, '100.01')).toBeNull();
    expect(sharesFromPercent(10n, 'abc')).toBeNull();
  });
});

describe('liquidityErrorKey', () => {
  const err = (codes) => ({ response: { data: { extras: { result_codes: codes } } } });
  it('bildet bekannte Op-Codes auf submitTransaction.failed:liquidity.* ab', () => {
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_success', 'op_bad_price'] }))).toBe('submitTransaction.failed:liquidity.op_bad_price');
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_cannot_delete'] }))).toBe('submitTransaction.failed:liquidity.op_cannot_delete');
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_under_minimum'] }))).toBe('submitTransaction.failed:liquidity.op_under_minimum');
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_trust_line_missing', 'op_success'] }))).toBe('submitTransaction.failed:liquidity.op_trust_line_missing');
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_not_aut_maintain_liabilities'] }))).toBe('submitTransaction.failed:liquidity.op_not_aut_maintain_liabilities');
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_success', 'op_trustline_frozen'] }))).toBe('submitTransaction.failed:liquidity.op_trustline_frozen');
    expect(liquidityErrorKey(err({ transaction: 'tx_bad_auth' }))).toBe('submitTransaction.failed:tx_bad_auth');
  });

  it('liefert null fuer unbekannte Codes und Fehler ohne Codes', () => {
    expect(liquidityErrorKey(err({ transaction: 'tx_failed', operations: ['op_too_few_offers'] }))).toBeNull();
    expect(liquidityErrorKey(new Error('x'))).toBeNull();
  });
});

describe('jobSubmitResultCodes', () => {
  const codes = { transaction: 'tx_failed', operations: ['op_success', 'op_bad_price'] };
  it('liest result_codes aus beiden Backend-Formen (PHP detail.extras, Node error.extras)', () => {
    expect(jobSubmitResultCodes({ error: 'Transaction Failed', detail: { extras: { result_codes: codes } } })).toEqual(codes);
    expect(jobSubmitResultCodes({ error: { title: 'Transaction Failed', extras: { result_codes: codes } } })).toEqual(codes);
    expect(liquidityErrorKeyFromResultCodes(jobSubmitResultCodes({ error: { extras: { result_codes: codes } } })))
      .toBe('submitTransaction.failed:liquidity.op_bad_price');
  });

  it('liefert null ohne verwertbare Codes', () => {
    expect(jobSubmitResultCodes(null)).toBeNull();
    expect(jobSubmitResultCodes({ error: 'boom' })).toBeNull();
    expect(jobSubmitResultCodes({ error: 'x', detail: { extras: { result_codes: 'unknown' } } })).toBeNull();
    expect(liquidityErrorKeyFromResultCodes(null)).toBeNull();
  });
});

describe('liquidityErrorKeyFromResultCodes mit Op-Liste (positional)', () => {
  const issuer = Keypair.random().publicKey();
  const usd = new Asset('USD', issuer);
  const poolId = poolIdFor(Asset.native(), usd);
  const ops = (...list) => {
    const builder = new TransactionBuilder(new Account(Keypair.random().publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
    list.forEach((op) => builder.addOperation(op));
    return builder.setTimeout(60).build().operations;
  };
  const payment = Operation.payment({ destination: issuer, asset: Asset.native(), amount: '1' });
  const withdraw = Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '1', minAmountA: '0', minAmountB: '0' });
  const poolTrust = Operation.changeTrust({ asset: new LiquidityPoolAsset(Asset.native(), usd, LiquidityPoolFeeV18) });
  const assetTrust = Operation.changeTrust({ asset: usd });

  it('kein LP-Text, wenn eine Zahlung scheitert und der LP-Op erfolgreich ist', () => {
    expect(liquidityErrorKeyFromResultCodes({ transaction: 'tx_failed', operations: ['op_underfunded', 'op_success'] }, ops(payment, withdraw))).toBeNull();
  });

  it('LP-Text fuer LP-Ops und changeTrust auf ein Pool-Asset, nicht fuer normale Trustlines', () => {
    expect(liquidityErrorKeyFromResultCodes({ transaction: 'tx_failed', operations: ['op_success', 'op_under_minimum'] }, ops(payment, withdraw)))
      .toBe('submitTransaction.failed:liquidity.op_under_minimum');
    expect(liquidityErrorKeyFromResultCodes({ transaction: 'tx_failed', operations: ['op_low_reserve', 'op_success'] }, ops(poolTrust, withdraw)))
      .toBe('submitTransaction.failed:liquidity.op_low_reserve');
    expect(liquidityErrorKeyFromResultCodes({ transaction: 'tx_failed', operations: ['op_low_reserve', 'op_success'] }, ops(assetTrust, withdraw))).toBeNull();
  });

  it('ohne Op-Liste wie bisher (direkter Weg)', () => {
    expect(liquidityErrorKeyFromResultCodes({ transaction: 'tx_failed', operations: ['op_underfunded'] })).toBe('submitTransaction.failed:liquidity.op_underfunded');
  });
});

describe('DE-Texte fuer Liquidity-Fehler', () => {
  it.each([...LIQUIDITY_OP_CODES, 'invalidInput', 'removeTrustPartial', 'alreadySent'])('%s hat einen Text in errors.json', (code) => {
    expect(typeof errors.submitTransaction.failed.liquidity[code]).toBe('string');
  });
});
