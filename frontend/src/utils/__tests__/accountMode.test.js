// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isIdentityMode, requiresGAccount } from '../accountMode.js';

describe('requiresGAccount', () => {
  it('returns true for every action that must operate on a real G-account', () => {
    for (const action of [
      'sendPayment',
      'listAll',
      'compare',
      'deleteAll',
      'deleteByIssuer',
      'multisigEdit',
      'multisigJobs',
      'createAccount',
      'muxed',
    ]) {
      expect(requiresGAccount(action)).toBe(true);
    }
  });

  it('returns false for an action not in the write-action set', () => {
    expect(requiresGAccount('viewBalance')).toBe(false);
  });

  it('returns false for missing/empty/non-string action ids without throwing', () => {
    expect(requiresGAccount(undefined)).toBe(false);
    expect(requiresGAccount(null)).toBe(false);
    expect(requiresGAccount('')).toBe(false);
  });
});

describe('isIdentityMode', () => {
  it('is true for a non-empty muxed address', () => {
    expect(isIdentityMode('MBZ...')).toBe(true);
  });

  it('is false for an empty, whitespace-only, or missing muxed address', () => {
    expect(isIdentityMode('')).toBe(false);
    expect(isIdentityMode('   ')).toBe(false);
    expect(isIdentityMode(undefined)).toBe(false);
    expect(isIdentityMode(null)).toBe(false);
  });
});
