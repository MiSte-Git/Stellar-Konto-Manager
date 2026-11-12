// Regression 12.11.2026: Nach Trustline und Swap blieb das Panel "Trustline fehlt" stehen, weil die
// erneute Abfrage den 10-s-Zwischenspeicher von loadTrustlines traf.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const loadTrustlines = vi.fn();
vi.mock('../../../../utils/stellar/stellarUtils.js', () => ({
  getHorizonServer: () => ({}),
  loadTrustlines: (...args) => loadTrustlines(...args),
}));

import useTrustlineStatus from '../useTrustlineStatus.js';

const ASSET = { assetCode: 'FOO', assetIssuer: 'G' + 'A'.repeat(55) };

describe('useTrustlineStatus', () => {
  beforeEach(() => loadTrustlines.mockReset());

  it('liest nach einer Aktualisierung ohne Zwischenspeicher und zeigt die neue Trustline', async () => {
    loadTrustlines
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ assetCode: 'FOO', assetIssuer: ASSET.assetIssuer, assetBalance: '0', limit: '10', isAuthorized: true }]);
    const props = { accountId: 'G' + 'B'.repeat(55), network: 'TESTNET', accountInput: 'x', selectedAsset: ASSET };
    const { result } = renderHook(() => useTrustlineStatus(props));
    await waitFor(() => expect(result.current.trustlineStatus.state).toBe('missing'));
    expect(loadTrustlines.mock.calls[0][2].ttlMs).toBe(10000);

    act(() => result.current.setTrustlineRefreshToken((v) => v + 1));
    await waitFor(() => expect(result.current.trustlineStatus.state).toBe('present'));
    expect(loadTrustlines.mock.calls[1][2].ttlMs).toBe(0);
  });
});
