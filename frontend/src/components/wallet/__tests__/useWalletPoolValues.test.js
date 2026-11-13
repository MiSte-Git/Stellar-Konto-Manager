import { renderHook, waitFor } from '@testing-library/react';
import useWalletPoolValues from '../useWalletPoolValues.js';
import { parseHorizonPoolAsset, poolIdFor } from '../../../utils/stellar/liquidityPools.js';

// Review W5: hoechstens 4 Pools gleichzeitig, Neuladen ohne Flackern.
const ISSUERS = [
  'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM',
  'GCTAWY73CNMLONWUID7TMJT55NW4MS2MHMW26O222UGG2PRFE6ZXEH7N',
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
];
const pools = Array.from({ length: 7 }, (_, i) => {
  const asset = `P${i}:${ISSUERS[i % 4]}`;
  const id = poolIdFor(parseHorizonPoolAsset('native'), parseHorizonPoolAsset(asset));
  return { id, record: { id, fee_bp: 30, total_shares: '10', reserves: [{ asset: 'native', amount: '10' }, { asset, amount: '20' }] } };
});
const hoisted = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../utils/stellar/stellarUtils.js', () => ({
  getHorizonServer: () => ({ liquidityPools: () => ({ liquidityPoolId: (id) => ({ call: () => hoisted.call(id) }) }) }),
}));

const account = { balances: pools.map((p) => ({ asset_type: 'liquidity_pool_shares', liquidity_pool_id: p.id, balance: '1' })) };

describe('useWalletPoolValues', () => {
  it('laedt hoechstens 4 Pools gleichzeitig und behaelt Werte beim Neuladen', async () => {
    let active = 0;
    let peak = 0;
    hoisted.call.mockImplementation(async (id) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return pools.find((p) => p.id === id).record;
    });
    const { result, rerender } = renderHook(({ acc }) => useWalletPoolValues(acc, 'PUBLIC', true), { initialProps: { acc: account } });
    await waitFor(() => expect(Object.values(result.current).every((v) => v.status === 'loaded')).toBe(true));
    expect(Object.keys(result.current)).toHaveLength(7);
    expect(peak).toBeLessThanOrEqual(4);
    rerender({ acc: { ...account } });
    // direkt nach dem Neuladen weiter geladen, nicht "loading"
    expect(Object.values(result.current).every((v) => v.status === 'loaded')).toBe(true);
  });

  it('ausgeschaltet laedt nichts', () => {
    hoisted.call.mockReset();
    renderHook(() => useWalletPoolValues(account, 'PUBLIC', false));
    expect(hoisted.call).not.toHaveBeenCalled();
  });
});
