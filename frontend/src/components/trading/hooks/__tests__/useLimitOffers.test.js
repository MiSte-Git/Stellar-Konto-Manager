// Regression 12.11.2026: Die Offers-Liste fragte Horizon aufsteigend mit limit 30. Hat ein Konto mehr
// Offers, fehlte das neueste (gerade platzierte).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const calls = [];
const call = vi.fn(async () => ({ records: [{ id: '1' }] }));
vi.mock('../../../../utils/stellar/stellarUtils.js', () => ({
  getHorizonServer: () => ({
    offers: () => {
      const builder = {
        forAccount: (id) => { calls.push(['forAccount', id]); return builder; },
        order: (dir) => { calls.push(['order', dir]); return builder; },
        limit: (n) => { calls.push(['limit', n]); return builder; },
        call,
      };
      return builder;
    },
  }),
}));

import useLimitOffers from '../useLimitOffers.js';

describe('useLimitOffers', () => {
  beforeEach(() => { calls.length = 0; call.mockClear(); });

  it('laedt die Offers neueste zuerst mit Limit 200', async () => {
    const props = {
      selectedAsset: { assetCode: 'FOO', assetIssuer: 'G' + 'A'.repeat(55) },
      accountId: 'G' + 'B'.repeat(55),
      network: 'TESTNET',
    };
    const { result } = renderHook(() => useLimitOffers(props));
    await waitFor(() => expect(result.current.limitOfferStatus.offers).toHaveLength(1));
    expect(calls).toContainEqual(['order', 'desc']);
    expect(calls).toContainEqual(['limit', 200]);
  });
});
