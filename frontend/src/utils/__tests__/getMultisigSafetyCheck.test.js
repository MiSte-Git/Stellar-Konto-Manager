// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getMultisigSafetyCheck } from '../getMultisigSafetyCheck.js';

const KEY_A = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const KEY_B = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

const t = (key) => key;

describe('getMultisigSafetyCheck', () => {
  it('reports no errors/warnings for a single owner-signed account with no thresholds set', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [],
      thresholds: { low: 0, med: 0, high: 0 },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags an account with zero active signers as unsignable in every relevant way', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: null,
      masterWeight: 0,
      signers: [],
      thresholds: { low: 1, med: 1, high: 2 },
    });
    expect(result.errors).toEqual([
      'common:multisigEdit.error.noActiveSigners',
      'common:multisigEdit.error.noEd25519Signers',
      'common:multisigEdit.error.masterZeroInsufficientHigh',
      'common:multisigEdit.error.thresholdHighUnreachable',
      'common:multisigEdit.error.thresholdMedUnreachable',
      'common:multisigEdit.error.setOptionsNotSignable',
    ]);
  });

  it('does not warn about a single signer when no additional signers are configured (plain account)', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [],
      thresholds: { low: 1, med: 1, high: 1 },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it('warns when signer rows exist but only a single valid signer can provide the high threshold', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [{ key: '', weight: 1 }],
      thresholds: { low: 0, med: 0, high: 1 },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['common:multisigEdit.warning.highSingleSigner']);
  });

  it('warns when an additional signer exists but thresholds stay 0/0/0 (any single signer controls the account)', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [{ key: KEY_B, weight: 1 }],
      thresholds: { low: 0, med: 0, high: 0 },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['common:multisigEdit.warning.singleSignerReachesHigh']);
    expect(result.risks).toEqual([]);
  });

  it('flags a 2-of-2 setup as a lockout risk (losing one key makes high unreachable)', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [{ key: KEY_B, weight: 1 }],
      thresholds: { low: 1, med: 2, high: 2 },
    });
    expect(result.errors).toEqual([]);
    expect(result.risks).toEqual(['common:multisigEdit.risk.noRedundancy']);
  });

  it('flags disabling the master key as a lockout risk', () => {
    const KEY_C = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: { signers: [{ key: KEY_A, weight: 1, type: 'ed25519_public_key' }] },
      defaultPublicKey: KEY_A,
      masterWeight: 0,
      signers: [{ key: KEY_B, weight: 1 }, { key: KEY_C, weight: 1 }],
      thresholds: { low: 1, med: 1, high: 1 },
    });
    expect(result.errors).toEqual([]);
    expect(result.risks).toEqual(['common:multisigEdit.risk.masterDisabled']);
  });

  it('errors when a special (non-ed25519) signer holds enough weight to reach high on its own', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: { signers: [{ type: 'sha256_hash', weight: 2 }] },
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [],
      thresholds: { low: 0, med: 0, high: 3 },
    });
    expect(result.errors).toEqual([
      'common:multisigEdit.error.specialSignerLastHigh',
      'common:multisigEdit.error.setOptionsNotSignable',
    ]);
  });

  it('ignores a signer entry with an invalid (non-ed25519) public key', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: null,
      masterWeight: 0,
      signers: [{ key: 'not-a-valid-stellar-key', weight: 10 }],
      thresholds: { low: 0, med: 0, high: 0 },
    });
    expect(result.errors).toContain('common:multisigEdit.error.noActiveSigners');
    expect(result.errors).toContain('common:multisigEdit.error.noEd25519Signers');
  });

  it('counts a valid additional signer toward total weight and ed25519 count', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: 1,
      signers: [{ key: KEY_B, weight: 1 }],
      thresholds: { low: 0, med: 0, high: 2 },
    });
    expect(result.errors).toEqual([]);
    // Two ed25519 signers now share the high threshold, so the single-signer warning must not fire.
    expect(result.warnings).toEqual([]);
  });

  it('clamps out-of-range weight/threshold inputs into the valid byte range instead of producing NaN', () => {
    const result = getMultisigSafetyCheck({
      t,
      currentAccount: null,
      defaultPublicKey: KEY_A,
      masterWeight: -50, // clamps to 0 -> the owner signer is filtered out entirely
      signers: [],
      thresholds: { low: -5, med: 'not-a-number', high: 300 }, // high clamps to 255
    });
    expect(result.errors).toEqual([
      'common:multisigEdit.error.noActiveSigners',
      'common:multisigEdit.error.noEd25519Signers',
      'common:multisigEdit.error.masterZeroInsufficientHigh',
      'common:multisigEdit.error.thresholdHighUnreachable',
      'common:multisigEdit.error.setOptionsNotSignable',
    ]);
  });
});
