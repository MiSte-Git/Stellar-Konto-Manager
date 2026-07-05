// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateMultisigConfig } from '../validateMultisigConfig.js';

describe('validateMultisigConfig', () => {
  it('is valid when no thresholds are configured, regardless of signers', () => {
    expect(validateMultisigConfig([], {})).toEqual({ valid: true });
  });

  it('is invalid when thresholds are set but there are no positively-weighted signers', () => {
    expect(validateMultisigConfig([], { high_threshold: 2 })).toEqual({ valid: false, reason: 'none' });
  });

  it('ignores signers with zero or missing weight when summing total weight', () => {
    const result = validateMultisigConfig(
      [{ weight: 0 }, { weight: 1 }],
      { low_threshold: 2 },
    );
    expect(result).toEqual({ valid: false, reason: 'low' });
  });

  it('reports the lowest unreachable threshold first (low before med before high)', () => {
    const signers = [{ weight: 1 }];
    expect(validateMultisigConfig(signers, { low_threshold: 2, med_threshold: 5, high_threshold: 10 }))
      .toEqual({ valid: false, reason: 'low' });
    expect(validateMultisigConfig(signers, { low_threshold: 1, med_threshold: 5, high_threshold: 10 }))
      .toEqual({ valid: false, reason: 'med' });
    expect(validateMultisigConfig(signers, { low_threshold: 1, med_threshold: 1, high_threshold: 10 }))
      .toEqual({ valid: false, reason: 'high' });
  });

  it('is valid when total signer weight reaches every configured threshold', () => {
    const signers = [{ weight: 3 }, { weight: 4 }];
    const result = validateMultisigConfig(signers, { low_threshold: 1, med_threshold: 5, high_threshold: 7 });
    expect(result).toEqual({ valid: true });
  });

  it('accepts the short-form threshold keys (low/med/high) as well as the *_threshold form', () => {
    const result = validateMultisigConfig([{ weight: 1 }], { low: 2 });
    expect(result).toEqual({ valid: false, reason: 'low' });
  });

  it('treats a non-array signers argument as empty rather than throwing', () => {
    expect(() => validateMultisigConfig(undefined, { high_threshold: 1 })).not.toThrow();
    expect(validateMultisigConfig(undefined, { high_threshold: 1 })).toEqual({ valid: false, reason: 'none' });
  });
});
