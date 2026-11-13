import { act, renderHook, waitFor } from '@testing-library/react';
import useTokenFlags, { resetTokenFlagCache } from '../useTokenFlags.js';

// Review W3/W8: Ergebnisse je Netz, spaete Antworten des alten Netzes landen nicht im neuen,
// der Cache ueberlebt das Aushaengen der Liste.
const A = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const B = 'GCTAWY73CNMLONWUID7TMJT55NW4MS2MHMW26O222UGG2PRFE6ZXEH7N';
const hoisted = vi.hoisted(() => ({ paths: vi.fn() }));
vi.mock('../../../../utils/stellar/stellarUtils.js', async (orig) => ({
  ...(await orig()),
  getHorizonServerForNetwork: (network) => ({
    strictSendPaths: (source) => ({ call: () => hoisted.paths(network, source.getCode()) }),
  }),
}));

const tokens = [{ code: 'AAA', issuer: A, balance: '1' }, { code: 'BBB', issuer: B, balance: '1' }];

function deferredFetch() {
  const pending = [];
  const fn = vi.fn((url, opts) => new Promise((resolve, reject) => {
    const u = new URL(String(url), 'http://x');
    pending.push({ issuer: u.searchParams.get('issuer'), network: u.searchParams.get('network'), resolve, reject, signal: opts?.signal });
  }));
  return { fn, pending };
}
const respond = (p, status) => p.resolve({ ok: true, json: async () => ({ status, tags: status === 'listed' ? ['malicious'] : [] }) });

beforeEach(() => { resetTokenFlagCache(); hoisted.paths.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('useTokenFlags', () => {
  it('spaete Antwort aus dem alten Netz erscheint nicht im neuen, Anfrage wird abgebrochen', async () => {
    const f = deferredFetch();
    vi.stubGlobal('fetch', f.fn);
    const { result, rerender } = renderHook(({ net }) => useTokenFlags(tokens, net, { scam: true }), { initialProps: { net: 'PUBLIC' } });
    await waitFor(() => expect(f.pending).toHaveLength(2));
    expect(result.current.scam[A]).toBe('loading');
    rerender({ net: 'TESTNET' });
    await waitFor(() => expect(f.pending).toHaveLength(4));
    expect(f.pending[0].signal.aborted).toBe(true);
    // alte Mainnet-Antwort kommt nach dem Wechsel: SCAM
    await act(async () => { respond(f.pending[0], 'listed'); });
    expect(result.current.scam[A]).toBe('loading');
    await act(async () => { respond(f.pending[2], 'unlisted'); respond(f.pending[3], 'unlisted'); });
    await waitFor(() => expect(result.current.scam[A]).toBe('no'));
    expect(f.pending[2].network).toBe('TESTNET');
  });

  it('Cache je Netz ueberlebt das Aushaengen, kein zweiter Abruf', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => (new URL(String(url), 'http://x').searchParams.get('issuer') === B ? { status: 'listed', tags: ['unsafe'] } : { status: 'unlisted', tags: [] }),
    })));
    const first = renderHook(() => useTokenFlags(tokens, 'PUBLIC', { scam: true }));
    await waitFor(() => expect(first.result.current.scam[B]).toBe('yes'));
    first.unmount();
    const calls = fetch.mock.calls.length;
    const second = renderHook(() => useTokenFlags(tokens, 'PUBLIC', { scam: true }));
    expect(second.result.current.scam).toEqual({ [A]: 'no', [B]: 'yes' });
    expect(fetch.mock.calls.length).toBe(calls);
    // anderes Netz: eigener Abruf
    renderHook(() => useTokenFlags(tokens, 'TESTNET', { scam: true }));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(calls + 2));
  });

  it('Marktpruefung je Netz und hoechstens 4 gleichzeitig', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ code: `T${i}`, issuer: A, balance: '1' }));
    let active = 0;
    let peak = 0;
    hoisted.paths.mockImplementation(async (network, code) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { records: code === 'T0' && network === 'PUBLIC' ? [{}] : [] };
    });
    const { result } = renderHook(() => useTokenFlags(many, 'PUBLIC', { market: true }));
    await waitFor(() => expect(Object.values(result.current.market).filter((v) => v !== 'loading')).toHaveLength(9));
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.current.market[`T0:${A}`]).toBe('yes');
    expect(result.current.market[`T1:${A}`]).toBe('no');
  });
});
