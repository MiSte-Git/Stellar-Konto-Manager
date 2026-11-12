import { loadTrustlines, sortTrustlines } from '../stellarUtils.js';

const PUBLIC_KEY = 'GB6L37KLRX6C6LYOGP265PYQYJZ7GUGAE3JJQV4NIFFGXPM3VN2TWZC3';

function serverFor(balances, id) {
  return { serverURL: `https://test-${id}.invalid`, loadAccount: async () => ({ balances }) };
}

// Regression: "Meine Trustlines" stuerzte ab (localeCompare auf undefined), sobald das Konto
// Pool Shares hielt. Pool-Share-Salden haben weder asset_code noch asset_issuer.
describe('loadTrustlines', () => {
  const balances = [
    { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'abc', balance: '4.8' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER2', balance: '10.5', limit: '1000' },
    { asset_type: 'credit_alphanum12', asset_code: 'PHPSTAR', asset_issuer: 'GISSUER1', balance: '3', limit: '1000' },
    { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'def', balance: '1' },
    { asset_type: 'native', balance: '100' },
  ];

  it('liefert nur Asset-Trustlines, keine Pool Shares und kein XLM', async () => {
    const list = await loadTrustlines(PUBLIC_KEY, serverFor(balances, 'a'), { includeOps: false, ttlMs: 0 });
    expect(list.map((t) => t.assetCode).sort()).toEqual(['PHPSTAR', 'USDC']);
    expect(list.every((t) => typeof t.assetCode === 'string' && typeof t.assetIssuer === 'string')).toBe(true);
  });

  it('laesst sich nach Code und Issuer sortieren, auch bei Konto mit Pool Shares', async () => {
    const list = await loadTrustlines(PUBLIC_KEY, serverFor(balances, 'b'), { includeOps: false, ttlMs: 0 });
    expect(() => sortTrustlines(list, 'assetCode', 'asc')).not.toThrow();
    expect(() => sortTrustlines(list, 'assetIssuer', 'desc')).not.toThrow();
    expect(sortTrustlines(list, 'assetCode', 'asc').map((t) => t.assetCode)).toEqual(['PHPSTAR', 'USDC']);
  });

  it('liefert eine leere Liste, wenn das Konto nur Pool Shares und XLM hat', async () => {
    const only = [
      { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'abc', balance: '1' },
      { asset_type: 'native', balance: '10' },
    ];
    const list = await loadTrustlines(PUBLIC_KEY, serverFor(only, 'c'), { includeOps: false, ttlMs: 0 });
    expect(list).toEqual([]);
  });
});
