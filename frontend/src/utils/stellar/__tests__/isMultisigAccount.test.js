// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isMultisigAccount } from '../isMultisigAccount.js';

describe('isMultisigAccount', () => {
  it('is false for a missing account or one without signers/thresholds', () => {
    expect(isMultisigAccount(null)).toBe(false);
    expect(isMultisigAccount({})).toBe(false);
    expect(isMultisigAccount({ signers: [] })).toBe(false);
    expect(isMultisigAccount({ thresholds: {} })).toBe(false);
  });

  it('is false for a plain single-signer account with a low high-threshold', () => {
    const account = { signers: [{ key: 'G...', weight: 1 }], thresholds: { high: 1 } };
    expect(isMultisigAccount(account)).toBe(false);
  });

  it('is true when there is more than one signer', () => {
    const account = {
      signers: [{ key: 'G1', weight: 1 }, { key: 'G2', weight: 1 }],
      thresholds: { high: 1 },
    };
    expect(isMultisigAccount(account)).toBe(true);
  });

  it('is true when the high threshold requires more than one signature, even with a single listed signer', () => {
    const account = { signers: [{ key: 'G1', weight: 2 }], thresholds: { high: 2 } };
    expect(isMultisigAccount(account)).toBe(true);
  });

  it('accepts the high_threshold key spelling as well as high', () => {
    const account = { signers: [{ key: 'G1', weight: 1 }], thresholds: { high_threshold: 2 } };
    expect(isMultisigAccount(account)).toBe(true);
  });

  it('filters out falsy entries in the signers array before counting', () => {
    const account = { signers: [{ key: 'G1', weight: 1 }, null, undefined], thresholds: { high: 1 } };
    expect(isMultisigAccount(account)).toBe(false);
  });
});
