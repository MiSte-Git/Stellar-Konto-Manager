import { computeWalletSummary, shortenAddress, splitAddressForCompare } from '../walletSummary.js';

describe('computeWalletSummary', () => {
  it('berechnet Reserve, Verfuegbar und sortiert Assets', () => {
    const summary = computeWalletSummary({
      subentry_count: 3,
      num_sponsoring: 1,
      num_sponsored: 2,
      balances: [
        { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'abc', balance: '5' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER2', balance: '10.5' },
        { asset_type: 'credit_alphanum4', asset_code: 'AQUA', asset_issuer: 'GISSUER1', balance: '1' },
        { asset_type: 'native', balance: '100', selling_liabilities: '20' },
      ],
    });
    // (2 + 3 + 1 - 2) * 0.5 = 2
    expect(summary.minReserve).toBe(2);
    expect(summary.xlm).toBe(100);
    expect(summary.available).toBe(78);
    expect(summary.assets.map((a) => a.code || 'pool')).toEqual(['AQUA', 'USDC', 'pool']);
  });

  it('wird nie negativ und liefert null ohne Konto', () => {
    expect(computeWalletSummary(null)).toBeNull();
    const s = computeWalletSummary({ subentry_count: 10, balances: [{ asset_type: 'native', balance: '1' }] });
    expect(s.available).toBe(0);
  });

  it('markiert Anfang und Ende zeichengenau, auch ueber Gruppengrenzen', () => {
    const groups = splitAddressForCompare('GABCDEFGHIJKLMNOPQRSTUVWXYZ', { edge: 6 });
    expect(groups[0]).toEqual([{ text: 'GABC', strong: true }]);
    expect(groups[1]).toEqual([{ text: 'DE', strong: true }, { text: 'FG', strong: false }]);
    expect(groups[5]).toEqual([{ text: 'T', strong: false }, { text: 'UVW', strong: true }]);
    expect(groups[6]).toEqual([{ text: 'XYZ', strong: true }]);
    const flat = groups.flat();
    expect(flat.map((s) => s.text).join('')).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(flat.filter((s) => s.strong).map((s) => s.text).join('')).toBe('GABCDEUVWXYZ');
    expect(splitAddressForCompare('')).toEqual([]);
  });

  it('kuerzt Adressen mit Anfang und Ende', () => {
    expect(shortenAddress('GABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('GABCDE…UVWXYZ');
    expect(shortenAddress('GABC')).toBe('GABC');
  });
});
