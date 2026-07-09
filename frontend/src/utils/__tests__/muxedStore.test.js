import { beforeEach, describe, expect, it } from 'vitest';
import {
  listMuxed,
  addMuxed,
  removeMuxed,
  importMuxedCsvText,
  getNextMuxedId,
  setNextMuxedId,
} from '../muxedStore.js';

const BASE_KEY = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
});

describe('importMuxedCsvText id canonicalization (Fix b1)', () => {
  it('stores a hex-formatted CSV id in canonical decimal form', () => {
    const csv = 'muxedId,label,note\n0x10,Hex Import,\n';
    const res = importMuxedCsvText(BASE_KEY, csv);
    expect(res.imported).toBe(1);
    const rows = listMuxed(BASE_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('16');
  });

  it('treats a hex id and its decimal equivalent as the same entry (no duplicate M-address)', () => {
    addMuxed(BASE_KEY, { id: '16', address: 'placeholder', label: 'Original' }, 'PUBLIC');
    const csv = 'muxedId,label,note\n0x10,Overwritten,\n';
    const res = importMuxedCsvText(BASE_KEY, csv);
    expect(res.imported).toBe(1);
    const rows = listMuxed(BASE_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('16');
    expect(rows[0].label).toBe('Overwritten');
  });

  it('canonicalizes a leading-zero id', () => {
    const csv = 'muxedId,label,note\n0010,Leading Zero,\n';
    const res = importMuxedCsvText(BASE_KEY, csv);
    expect(res.imported).toBe(1);
    expect(listMuxed(BASE_KEY)[0].id).toBe('10');
  });

  it('still rejects a non-numeric id', () => {
    // No trailing newline: the CSV parser treats a trailing "\n" as introducing
    // one more (empty) row, which would also count as skipped and muddy this assertion.
    const csv = 'muxedId,label,note\nnot-a-number,Bad,';
    const res = importMuxedCsvText(BASE_KEY, csv);
    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);
    expect(listMuxed(BASE_KEY)).toHaveLength(0);
  });
});

describe('persistent next-id counter (Fix a3)', () => {
  it('starts at 1 for an account with no entries', () => {
    expect(getNextMuxedId(BASE_KEY)).toBe('1');
  });

  it('migrates from the highest existing id on first use', () => {
    addMuxed(BASE_KEY, { id: '5', address: 'a' }, 'PUBLIC');
    addMuxed(BASE_KEY, { id: '12', address: 'b' }, 'PUBLIC');
    expect(getNextMuxedId(BASE_KEY)).toBe('13');
  });

  it('does not reissue a deleted id once the counter has advanced past it', () => {
    addMuxed(BASE_KEY, { id: '1', address: 'a' }, 'PUBLIC');
    addMuxed(BASE_KEY, { id: '2', address: 'b' }, 'PUBLIC');
    setNextMuxedId(BASE_KEY, '3', 'PUBLIC');

    removeMuxed(BASE_KEY, ['2'], 'PUBLIC');

    // Without a persistent counter this would fall back to max(existing)+1 = 2,
    // reissuing the just-deleted id.
    expect(getNextMuxedId(BASE_KEY)).toBe('3');
  });

  it('keeps counters separate per network', () => {
    setNextMuxedId(BASE_KEY, '7', 'PUBLIC');
    setNextMuxedId(BASE_KEY, '42', 'TESTNET');
    expect(getNextMuxedId(BASE_KEY, 'PUBLIC')).toBe('7');
    expect(getNextMuxedId(BASE_KEY, 'TESTNET')).toBe('42');
  });
});
