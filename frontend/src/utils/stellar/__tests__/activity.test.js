import {
  findLookalikeCounterparties,
  isDust,
  matchesMuxed,
  normalizeActivity,
  safeHttpUrl,
  sanitizeMemo,
} from '../activity.js';

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const FRIEND = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
// gleicher Anfang (GD5KJ) und gleiches Ende (ZVKM), sonst anders
const FAKE = 'GD5KJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZVKM';

describe('activity', () => {
  it('entfernt Steuer- und Bidi-Zeichen und kuerzt Memos', () => {
    expect(sanitizeMemo('Hallo\u202Egnp.exe')).toBe('Hallognp.exe');
    expect(sanitizeMemo('a\u200Bb\nc')).toBe('ab c');
    expect(sanitizeMemo('x'.repeat(80))).toHaveLength(64);
    expect(sanitizeMemo(null)).toBe('');
  });

  it('normalisiert Zahlungen in beide Richtungen', () => {
    const inc = normalizeActivity({ type: 'payment', from: FRIEND, to: ME, amount: '5.5', asset_type: 'native', transaction_hash: 'h1', transaction: { memo_type: 'text', memo: 'Danke' } }, ME);
    expect(inc).toMatchObject({ direction: 'in', counterparty: FRIEND, amount: 5.5, memo: 'Danke', memoType: 'text' });
    expect(inc.asset.isNative).toBe(true);

    const out = normalizeActivity({ type: 'payment', from: ME, to: FRIEND, amount: '3', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: FRIEND }, ME);
    expect(out).toMatchObject({ direction: 'out', counterparty: FRIEND, asset: { code: 'USDC', issuer: FRIEND, isNative: false } });

    const created = normalizeActivity({ type: 'create_account', account: ME, funder: FRIEND, starting_balance: '2' }, ME);
    expect(created).toMatchObject({ kind: 'createAccount', direction: 'in', counterparty: FRIEND, amount: 2 });

    expect(normalizeActivity({ type: 'manage_data' }, ME)).toBeNull();
  });

  it('erkennt XLM-Kleinstzahlungen, aber keine Kontoerstellung', () => {
    expect(isDust({ direction: 'in', kind: 'payment', asset: { isNative: true }, amount: 0.0000001 })).toBe(true);
    expect(isDust({ direction: 'in', kind: 'payment', asset: { isNative: true }, amount: 1 })).toBe(false);
    expect(isDust({ direction: 'out', kind: 'payment', asset: { isNative: true }, amount: 0.0001 })).toBe(false);
    expect(isDust({ direction: 'in', kind: 'payment', asset: { isNative: false }, amount: 0.0001 })).toBe(false);
  });

  it('markiert Lookalike-Absender von bekannten Empfaengern', () => {
    const items = [
      { direction: 'out', counterparty: FRIEND },
      { direction: 'in', counterparty: FAKE },
      { direction: 'in', counterparty: FRIEND },
    ];
    const s = findLookalikeCounterparties(items);
    expect(s.has(FAKE)).toBe(true);
    expect(s.has(FRIEND)).toBe(false);
    expect(findLookalikeCounterparties([{ direction: 'in', counterparty: FAKE }]).size).toBe(0);
  });

  it('filtert auf Muxed-Identitaet', () => {
    expect(matchesMuxed({ to_muxed: 'M1' }, 'M1')).toBe(true);
    expect(matchesMuxed({ to_muxed: 'M2' }, 'M1')).toBe(false);
    expect(matchesMuxed({}, '')).toBe(true);
  });

  it('laesst nur http(s)-Links zu', () => {
    expect(safeHttpUrl('https://stellar.expert/explorer/public/tx/abc')).toMatch(/^https:/);
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('data:text/html,x')).toBe('');
  });
});
