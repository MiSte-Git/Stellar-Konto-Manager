// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getRequiredThreshold } from '../getRequiredThreshold.js';

describe('getRequiredThreshold', () => {
  it('returns 0 when thresholds is missing or not an object', () => {
    expect(getRequiredThreshold('payment', null)).toBe(0);
    expect(getRequiredThreshold('payment', undefined)).toBe(0);
    expect(getRequiredThreshold('payment', 'nope')).toBe(0);
  });

  it('setOptions requires the high threshold when set', () => {
    expect(getRequiredThreshold('setOptions', { low_threshold: 1, med_threshold: 2, high_threshold: 3 })).toBe(3);
  });

  it('setOptions: high 0 faellt nicht auf med zurueck, es gilt max(low, high)', () => {
    expect(getRequiredThreshold('setOptions', { low_threshold: 1, med_threshold: 2, high_threshold: 0 })).toBe(1);
    expect(getRequiredThreshold('setOptions', { low_threshold: 1, med_threshold: 0, high_threshold: 0 })).toBe(1);
    expect(getRequiredThreshold('setOptions', { low_threshold: 2, med_threshold: 0, high_threshold: 1 })).toBe(2);
  });

  it('accountMerge ist High', () => {
    expect(getRequiredThreshold('accountMerge', { low_threshold: 1, med_threshold: 2, high_threshold: 3 })).toBe(3);
  });

  it('payment requires the medium threshold when set', () => {
    expect(getRequiredThreshold('payment', { low_threshold: 1, med_threshold: 2, high_threshold: 3 })).toBe(2);
  });

  it('payment: med 0 faellt nicht auf high zurueck, es gilt max(low, med) (Probe G, H)', () => {
    expect(getRequiredThreshold('payment', { low_threshold: 1, med_threshold: 0, high_threshold: 3 })).toBe(1);
    expect(getRequiredThreshold('payment', { low_threshold: 1, med_threshold: 0, high_threshold: 0 })).toBe(1);
    expect(getRequiredThreshold('payment', { low_threshold: 2, med_threshold: 1, high_threshold: 1 })).toBe(2);
  });

  it('bumpSequence requires exactly the low threshold, including 0', () => {
    expect(getRequiredThreshold('bumpSequence', { low_threshold: 1, med_threshold: 2, high_threshold: 3 })).toBe(1);
    expect(getRequiredThreshold('bumpSequence', { low_threshold: 0, med_threshold: 2, high_threshold: 3 })).toBe(0);
  });

  it('falls back to the medium threshold for an unknown operation type', () => {
    expect(getRequiredThreshold('somethingElse', { low_threshold: 1, med_threshold: 2, high_threshold: 3 })).toBe(2);
  });

  it('accepts the camelCase and short threshold key variants', () => {
    expect(getRequiredThreshold('payment', { medThreshold: 4 })).toBe(4);
    expect(getRequiredThreshold('payment', { med: 5 })).toBe(5);
  });

  it('returns 0 when every threshold is zero/unset', () => {
    expect(getRequiredThreshold('payment', {})).toBe(0);
  });
});
