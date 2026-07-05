// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildMuxedAddress } from '../muxed.js';

const BASE_KEY = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';

describe('buildMuxedAddress', () => {
  it('builds a valid M-address that decodes back to the exact base key and id', () => {
    const m = buildMuxedAddress(BASE_KEY, '12345');
    expect(m.startsWith('M')).toBe(true);
    expect(StrKey.isValidMed25519PublicKey(m)).toBe(true);

    const decoded = StrKey.decodeMed25519PublicKey(m);
    const rawG = StrKey.decodeEd25519PublicKey(BASE_KEY);
    expect(decoded.subarray(0, 32).equals(rawG)).toBe(true);
    expect(decoded.subarray(32).readBigUInt64BE()).toBe(12345n);
  });

  it('accepts id 0 (the minimum valid uint64)', () => {
    const m = buildMuxedAddress(BASE_KEY, 0);
    const decoded = StrKey.decodeMed25519PublicKey(m);
    expect(decoded.subarray(32).readBigUInt64BE()).toBe(0n);
  });

  it('accepts the maximum uint64 id (2^64 - 1)', () => {
    const max = '18446744073709551615';
    const m = buildMuxedAddress(BASE_KEY, max);
    const decoded = StrKey.decodeMed25519PublicKey(m);
    expect(decoded.subarray(32).readBigUInt64BE()).toBe(18446744073709551615n);
  });

  it('rejects an id one past the uint64 maximum', () => {
    expect(() => buildMuxedAddress(BASE_KEY, '18446744073709551616'))
      .toThrow('submitTransaction.failed:createAccount.muxedIdInvalid');
  });

  it('rejects a negative id', () => {
    expect(() => buildMuxedAddress(BASE_KEY, '-1'))
      .toThrow('submitTransaction.failed:createAccount.muxedIdInvalid');
  });

  it('rejects an id that is not an integer', () => {
    expect(() => buildMuxedAddress(BASE_KEY, 'not-a-number'))
      .toThrow('submitTransaction.failed:createAccount.muxedIdInvalid');
  });

  it('rejects a missing base public key', () => {
    expect(() => buildMuxedAddress('', '1'))
      .toThrow('submitTransaction.failed:muxed.error.invalidBaseAccount');
    expect(() => buildMuxedAddress(undefined, '1'))
      .toThrow('submitTransaction.failed:muxed.error.invalidBaseAccount');
  });

  it('rejects a base key that is not a valid ed25519 public key (e.g. an M-address)', () => {
    const someM = buildMuxedAddress(BASE_KEY, '1');
    expect(() => buildMuxedAddress(someM, '1'))
      .toThrow('submitTransaction.failed:muxed.error.invalidBaseAccount');
  });

  it('rejects a missing muxed id', () => {
    expect(() => buildMuxedAddress(BASE_KEY, undefined))
      .toThrow('submitTransaction.failed:muxed.error.noId');
    expect(() => buildMuxedAddress(BASE_KEY, ''))
      .toThrow('submitTransaction.failed:muxed.error.noId');
  });

  it('produces different addresses for different ids on the same base key', () => {
    const m1 = buildMuxedAddress(BASE_KEY, '1');
    const m2 = buildMuxedAddress(BASE_KEY, '2');
    expect(m1).not.toBe(m2);
  });
});
