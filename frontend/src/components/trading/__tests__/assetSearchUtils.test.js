// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  getIssuerLockStatus,
  getAssetTotalAmountNumber,
  deriveOrderbookMidRate,
  bestPathDestinationAmount,
} from '../assetSearchUtils.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const OTHER_SIGNER = 'GBXOTHERKEY00000000000000000000000000000000000000000000';

describe('getIssuerLockStatus', () => {
  it('returns unknown when the master signer is not found in signers', () => {
    const status = getIssuerLockStatus({ signers: [] }, ISSUER);
    expect(status.status).toBe('unknown');
    expect(status.masterWeight).toBe(null);
  });

  it('returns unknown when the issuer account itself is missing (not yet loaded)', () => {
    const status = getIssuerLockStatus(null, ISSUER);
    expect(status.status).toBe('unknown');
    expect(status.masterWeight).toBe(null);
  });

  it('returns active when the master key still has weight - this is normal, not a warning', () => {
    const status = getIssuerLockStatus({
      signers: [{ key: ISSUER, weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    }, ISSUER);
    expect(status.status).toBe('active');
    expect(status.masterWeight).toBe(1);
  });

  it('returns locked when master weight is 0 and no other signer remains', () => {
    const status = getIssuerLockStatus({
      signers: [{ key: ISSUER, weight: 0 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    }, ISSUER);
    expect(status.status).toBe('locked');
    expect(status.otherSignersWeight).toBe(0);
  });

  it('returns locked when other signers exist but cannot reach any threshold', () => {
    const status = getIssuerLockStatus({
      signers: [
        { key: ISSUER, weight: 0 },
        { key: OTHER_SIGNER, weight: 1 },
      ],
      thresholds: { low_threshold: 10, med_threshold: 10, high_threshold: 10 },
    }, ISSUER);
    expect(status.status).toBe('locked');
    expect(status.otherSignersWeight).toBe(1);
  });

  it('returns appearsLocked when a replacement signer\'s weight reaches the lowest threshold - the deceptive case', () => {
    const status = getIssuerLockStatus({
      signers: [
        { key: ISSUER, weight: 0 },
        { key: OTHER_SIGNER, weight: 5 },
      ],
      thresholds: { low_threshold: 5, med_threshold: 10, high_threshold: 20 },
    }, ISSUER);
    expect(status.status).toBe('appearsLocked');
    expect(status.otherSignersWeight).toBe(5);
  });

  it('returns locked when master weight is 0 and no other signer remains, even with unconfigured (0/0/0) thresholds - a weight-0 signer can never produce a usable signature, so this is the documented way to lock a fixed-supply issuer', () => {
    const status = getIssuerLockStatus({
      signers: [{ key: ISSUER, weight: 0 }],
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    }, ISSUER);
    expect(status.status).toBe('locked');
    expect(status.otherSignersWeight).toBe(0);
  });

  it('returns appearsLocked when a threshold is 0 AND another weighted signer exists - that signer alone can already satisfy the 0-threshold category', () => {
    const status = getIssuerLockStatus({
      signers: [
        { key: ISSUER, weight: 0 },
        { key: OTHER_SIGNER, weight: 1 },
      ],
      thresholds: { low_threshold: 0, med_threshold: 10, high_threshold: 10 },
    }, ISSUER);
    expect(status.status).toBe('appearsLocked');
    expect(status.otherSignersWeight).toBe(1);
  });

  it('treats a non-numeric signer weight as 0 rather than producing NaN comparisons', () => {
    const status = getIssuerLockStatus({
      signers: [
        { key: ISSUER, weight: 0 },
        { key: OTHER_SIGNER, weight: 'not-a-number' },
      ],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    }, ISSUER);
    expect(status.status).toBe('locked');
    expect(status.otherSignersWeight).toBe(0);
  });

  it('falls back to signer presence when thresholds are missing entirely', () => {
    const lockedNoOthers = getIssuerLockStatus({ signers: [{ key: ISSUER, weight: 0 }] }, ISSUER);
    expect(lockedNoOthers.status).toBe('locked');

    const appearsLockedWithOthers = getIssuerLockStatus({
      signers: [{ key: ISSUER, weight: 0 }, { key: OTHER_SIGNER, weight: 3 }],
    }, ISSUER);
    expect(appearsLockedWithOthers.status).toBe('appearsLocked');
  });
});

describe('getAssetTotalAmountNumber', () => {
  it('returns the trustline amount alone when there are no claimable balances, pools, or contracts', () => {
    expect(getAssetTotalAmountNumber({ amount: '1000.0000000' })).toBe(1000);
  });

  it('sums trustlines, claimable balances, liquidity pools, and contract balances - not just the trustline total', () => {
    const total = getAssetTotalAmountNumber({
      amount: '1000',
      claimableBalancesAmount: '50',
      liquidityPoolsAmount: '20',
      contractsAmount: '5',
    });
    expect(total).toBe(1075);
  });

  it('treats missing fields as 0 rather than making the whole sum null', () => {
    expect(getAssetTotalAmountNumber({ amount: '1000', liquidityPoolsAmount: '20' })).toBe(1020);
  });

  it('returns null when there is no amount data anywhere (not even 0)', () => {
    expect(getAssetTotalAmountNumber({})).toBe(null);
  });
});

describe('deriveOrderbookMidRate', () => {
  it('averages best bid and best ask when both sides are present', () => {
    const rate = deriveOrderbookMidRate({
      bids: [{ price: '10' }],
      asks: [{ price: '12' }],
    });
    expect(rate.baseToCounter).toBe(11);
    expect(rate.counterToBase).toBeCloseTo(1 / 11);
  });

  it('falls back to the single available side when the book is one-sided', () => {
    const bidOnly = deriveOrderbookMidRate({ bids: [{ price: '10' }], asks: [] });
    expect(bidOnly.baseToCounter).toBe(10);

    const askOnly = deriveOrderbookMidRate({ bids: [], asks: [{ price: '12' }] });
    expect(askOnly.baseToCounter).toBe(12);
  });

  it('returns nulls (never a division by zero) for a completely empty book', () => {
    const rate = deriveOrderbookMidRate({ bids: [], asks: [] });
    expect(rate.baseToCounter).toBe(null);
    expect(rate.counterToBase).toBe(null);
  });

  it('treats a missing/malformed orderbook the same as an empty one', () => {
    expect(deriveOrderbookMidRate(null)).toEqual({ baseToCounter: null, counterToBase: null });
    expect(deriveOrderbookMidRate({})).toEqual({ baseToCounter: null, counterToBase: null });
  });
});

describe('bestPathDestinationAmount', () => {
  it('picks the record with the highest destination amount', () => {
    const amount = bestPathDestinationAmount({
      records: [
        { destination_amount: '5.5' },
        { destination_amount: '9.25' },
        { destination_amount: '7' },
      ],
    });
    expect(amount).toBe(9.25);
  });

  it('returns null (not 0) when there are no records, so "no route" is never mistaken for a zero rate', () => {
    expect(bestPathDestinationAmount({ records: [] })).toBe(null);
    expect(bestPathDestinationAmount(null)).toBe(null);
  });

  it('returns null for a non-positive or unparseable destination amount', () => {
    expect(bestPathDestinationAmount({ records: [{ destination_amount: '0' }] })).toBe(null);
    expect(bestPathDestinationAmount({ records: [{ destination_amount: 'not-a-number' }] })).toBe(null);
  });
});
