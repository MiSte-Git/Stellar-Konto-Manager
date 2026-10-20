import { describe, it, expect } from 'vitest';
import { accountRequiresMemo, isAccountRequiresMemoError, MEMO_REQUIRED_DATA_KEY } from '../memoRequired.js';

describe('accountRequiresMemo (SEP-29)', () => {
  it('erkennt config.memo_required = "1" (base64 MQ==)', () => {
    expect(accountRequiresMemo({ data_attr: { [MEMO_REQUIRED_DATA_KEY]: 'MQ==' } })).toBe(true);
  });

  it('ignoriert andere Werte, andere Keys und fehlende Daten', () => {
    expect(accountRequiresMemo({ data_attr: { [MEMO_REQUIRED_DATA_KEY]: 'MA==' } })).toBe(false); // "0"
    expect(accountRequiresMemo({ data_attr: { [MEMO_REQUIRED_DATA_KEY]: '1' } })).toBe(false); // nicht base64
    expect(accountRequiresMemo({ data_attr: { other: 'MQ==' } })).toBe(false);
    expect(accountRequiresMemo({ data_attr: {} })).toBe(false);
    expect(accountRequiresMemo({})).toBe(false);
    expect(accountRequiresMemo(null)).toBe(false);
  });
});

describe('isAccountRequiresMemoError', () => {
  it('erkennt den Fehler des stellar-sdk am Namen', () => {
    const err = new Error('account requires memo');
    err.name = 'AccountRequiresMemoError';
    expect(isAccountRequiresMemoError(err)).toBe(true);
    expect(isAccountRequiresMemoError(new Error('x'))).toBe(false);
    expect(isAccountRequiresMemoError(undefined)).toBe(false);
  });
});
