import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../stellar/accountUtils.js', () => ({
  isTestnetAccount: vi.fn(async () => false),
}));

import { useTrustedWallets } from '../useTrustedWallets.js';

const LS_KEY = 'stm_trusted_wallets';
const ADDR_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADDR_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function jsonFile(obj) {
  const text = JSON.stringify(obj);
  return { text: async () => text };
}

// Regression: setWallets emitted the change event before the new list was in
// localStorage. Every instance (including the importing one) re-read the old
// list on that event and overwrote the freshly imported data.
describe('useTrustedWallets import', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('importFile keeps the imported wallets and persists them', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ wallets: [{ address: ADDR_A, label: 'alt' }] }));
    const { result } = renderHook(() => useTrustedWallets());

    let res;
    await act(async () => {
      res = await result.current.importFile(jsonFile({ wallets: [{ address: ADDR_B, label: 'neu' }] }));
    });

    expect(res).toEqual({ ok: true });
    await waitFor(() => expect(result.current.wallets.map((w) => w.address)).toEqual([ADDR_B]));
    expect(JSON.parse(localStorage.getItem(LS_KEY)).wallets.map((w) => w.address)).toEqual([ADDR_B]);
  });

  it('a second mounted instance sees the imported wallets', async () => {
    const { result: editor } = renderHook(() => useTrustedWallets());
    const { result: header } = renderHook(() => useTrustedWallets());

    await act(async () => {
      await editor.current.importFile(jsonFile({ wallets: [{ address: ADDR_B, label: 'neu' }] }));
    });

    await waitFor(() => expect(header.current.wallets.map((w) => w.address)).toEqual([ADDR_B]));
    expect(editor.current.wallets.map((w) => w.address)).toEqual([ADDR_B]);
  });
});
