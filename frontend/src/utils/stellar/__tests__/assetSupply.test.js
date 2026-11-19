import { assetSupplyFromRecord, pickAssetRecord } from '../assetSupply.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const rec = (over = {}) => ({
  asset_code: 'USDC', asset_issuer: ISSUER,
  accounts: { authorized: 5, authorized_to_maintain_liabilities: 1, unauthorized: 0 },
  balances: { authorized: '0.1', authorized_to_maintain_liabilities: '0.2', unauthorized: '0' },
  ...over,
});

describe('assetSupplyFromRecord', () => {
  it('summiert exakt in Stroops (kein Gleitkommafehler)', () => {
    const r = assetSupplyFromRecord(rec({ claimable_balances_amount: '0.0000001' }), 'USDC', ISSUER);
    expect(r.supply.trustlines).toBe('0.3');
    expect(r.supply.total).toBe('0.3000001');
    expect(r.supply.claimable).toBe('0.0000001');
    expect(r.holders).toEqual({ total: 6, authorized: 5, maintain: 1, unauthorized: 0 });
  });

  it('grosse Mengen bleiben exakt', () => {
    const r = assetSupplyFromRecord(rec({ balances: { authorized: '922337203685.4775807', authorized_to_maintain_liabilities: '922337203685.4775807', unauthorized: '0' } }), 'USDC', ISSUER);
    expect(r.supply.total).toBe('1844674407370.9551614');
  });

  it('Teilmengen 0 erscheinen nicht', () => {
    const r = assetSupplyFromRecord(rec({ liquidity_pools_amount: '0', contracts_amount: '0.0000000' }), 'USDC', ISSUER);
    expect(r.supply.pools).toBeUndefined();
    expect(r.supply.contracts).toBeUndefined();
  });

  it('fail-closed: anderes Asset, fehlende Teile, ungueltige Betraege ergeben null', () => {
    expect(assetSupplyFromRecord(rec(), 'usdc', ISSUER)).toBeNull();
    expect(assetSupplyFromRecord(rec(), 'USDC', 'GOTHER')).toBeNull();
    expect(assetSupplyFromRecord(rec({ accounts: { authorized: 1 } }), 'USDC', ISSUER)).toBeNull();
    expect(assetSupplyFromRecord(rec({ balances: { authorized: '-1', authorized_to_maintain_liabilities: '0', unauthorized: '0' } }), 'USDC', ISSUER)).toBeNull();
    expect(assetSupplyFromRecord(rec({ balances: { authorized: '1.00000001', authorized_to_maintain_liabilities: '0', unauthorized: '0' } }), 'USDC', ISSUER)).toBeNull();
    expect(assetSupplyFromRecord(rec({ claimable_balances_amount: 'abc' }), 'USDC', ISSUER)).toBeNull();
    expect(assetSupplyFromRecord(null, 'USDC', ISSUER)).toBeNull();
  });

  it('Anzahl als String wird gelesen, ungueltige Anzahl nicht', () => {
    expect(assetSupplyFromRecord(rec({ accounts: { authorized: '7', authorized_to_maintain_liabilities: '0', unauthorized: '0' } }), 'USDC', ISSUER).holders.total).toBe(7);
    expect(assetSupplyFromRecord(rec({ accounts: { authorized: 1.5, authorized_to_maintain_liabilities: 0, unauthorized: 0 } }), 'USDC', ISSUER)).toBeNull();
  });
});

describe('pickAssetRecord', () => {
  it('waehlt den Datensatz mit genau diesem Code (Gross-/Kleinschreibung)', () => {
    const a = rec({ asset_code: 'usdc' });
    const b = rec();
    expect(pickAssetRecord([a, b], 'USDC', ISSUER)).toBe(b);
    expect(pickAssetRecord([a], 'USDC', ISSUER)).toBeNull();
    expect(pickAssetRecord(undefined, 'USDC', ISSUER)).toBeNull();
  });
});
