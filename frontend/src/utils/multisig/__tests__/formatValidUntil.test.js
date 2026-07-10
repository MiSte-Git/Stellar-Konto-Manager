import { describe, expect, it } from 'vitest';
import { formatValidUntil } from '../formatValidUntil.js';

// Mirrors both call conventions react-i18next's t() supports: t(key, 'fallback string')
// and t(key, { defaultValue: '...' }) - formatValidUntil.js uses the former.
function fakeT(key, optsOrDefault) {
  if (typeof optsOrDefault === 'string') return optsOrDefault;
  return optsOrDefault?.defaultValue || key;
}

describe('formatValidUntil', () => {
  it('returns the "unbounded" fallback for maxTime "0" (Stellar\'s own unbounded convention)', () => {
    expect(formatValidUntil('0', 'en', fakeT)).toBe('unbegrenzt');
  });

  it('returns the "unbounded" fallback for a missing/undefined maxTime', () => {
    expect(formatValidUntil(undefined, 'en', fakeT)).toBe('unbegrenzt');
    expect(formatValidUntil('', 'en', fakeT)).toBe('unbegrenzt');
  });

  it('formats a real unix-seconds maxTime as a localized date/time string, not the unbounded fallback', () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 3600;
    const out = formatValidUntil(String(futureUnix), 'en-US', fakeT);
    expect(out).not.toBe('unbegrenzt');
    expect(out.length).toBeGreaterThan(0);
  });

  it('accepts a numeric maxTime as well as a string one (tx.timeBounds.maxTime is always a string in practice, but the helper should not assume it)', () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 3600;
    const asString = formatValidUntil(String(futureUnix), 'en-US', fakeT);
    const asNumber = formatValidUntil(futureUnix, 'en-US', fakeT);
    expect(asNumber).toBe(asString);
  });

  it('respects the language argument by producing different formatting for en-US vs de-DE', () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 3600;
    const en = formatValidUntil(String(futureUnix), 'en-US', fakeT);
    const de = formatValidUntil(String(futureUnix), 'de-DE', fakeT);
    // Not asserting exact strings (locale data can vary by ICU version) - just
    // that the language actually influences the output, proving i18n.language
    // is wired through rather than a hardcoded locale.
    expect(en).not.toBe(de);
  });

  it('falls back to an ISO string rather than throwing if Intl.DateTimeFormat rejects the language tag', () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 3600;
    expect(() => formatValidUntil(String(futureUnix), 'not-a-real-locale-tag-xyz', fakeT)).not.toThrow();
  });

  it('returns "-" for a maxTime that is not a parseable number', () => {
    expect(formatValidUntil('not-a-number', 'en', fakeT)).toBe('-');
  });
});
