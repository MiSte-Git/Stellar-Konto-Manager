import { describe, expect, it } from 'vitest';
import { parseSlippagePercent, sharesFromPercent } from '../dialogInputs.js';
import { LIQUIDITY_OP_CODES, liquidityErrorKey } from '../../../utils/stellar/liquidityErrors.js';
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

describe('DE-Texte fuer Liquidity-Fehler', () => {
  it.each([...LIQUIDITY_OP_CODES, 'invalidInput', 'removeTrustPartial', 'alreadySent'])('%s hat einen Text in errors.json', (code) => {
    expect(typeof errors.submitTransaction.failed.liquidity[code]).toBe('string');
  });
});
