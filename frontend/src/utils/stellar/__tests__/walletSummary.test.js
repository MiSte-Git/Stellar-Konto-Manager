import { computeWalletSummary, shortenAddress } from '../walletSummary.js';

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

  it('kuerzt Adressen mit Anfang und Ende', () => {
    expect(shortenAddress('GABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('GABCDE…UVWXYZ');
    expect(shortenAddress('GABC')).toBe('GABC');
  });
});
