import { useEffect, useState } from 'react';
import { getHorizonServer, loadTrustlines } from '../../../utils/stellar/stellarUtils.js';
import { DEFAULT_TRUSTLINE_LIMIT } from '../assetSearchUtils.js';

/**
 * Trustline status for the selected asset: present/missing/error/loading,
 * balance/limit/authorization when present, the "add trustline" limit form
 * field, and a refresh token to re-check after a submitted change. Extracted
 * from AssetSearch.jsx (step 5 of the file-split, hook 3/6).
 *
 * trustlineRefreshToken is returned (with its setter) rather than kept
 * private, because the container's own accountInfo-loading effect (not yet
 * extracted - that's useTradingAccount, hook 6) also depends on it: a
 * submitted trustline change must refresh both the trustline check here and
 * the account's reserve/balance snapshot there.
 *
 * Reset cascade: the original combined [selectedAsset, network]-reset effect
 * (AssetSearch.jsx, before this extraction) also reset showTrustlineConfirm/
 * showTrustlineSwapConfirm and tokenFactsExpanded, neither of which belong to
 * trustline status. That effect is split further: this hook takes over only
 * the trustlineLimit reset; the container keeps the rest (both step-6/
 * confirm-pipeline territory or a plain UI toggle with no fetch effect).
 */
export default function useTrustlineStatus({ accountId, network, selectedAsset }) {
  const [trustlineStatus, setTrustlineStatus] = useState({ loading: false, state: 'unknown', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
  const [trustlineLimit, setTrustlineLimit] = useState(DEFAULT_TRUSTLINE_LIMIT);
  const [trustlineRefreshToken, setTrustlineRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAsset || !accountId) {
      setTrustlineStatus({ loading: false, state: accountId ? 'unknown' : 'noAccount', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
      return () => { cancelled = true; };
    }

    setTrustlineStatus({ loading: true, state: 'loading', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    loadTrustlines(accountId, server, { includeOps: false, ttlMs: 10000 })
      .then((trustlines) => {
        if (cancelled) return;
        const match = trustlines.find((tl) =>
          tl.assetCode === selectedAsset.assetCode &&
          tl.assetIssuer === selectedAsset.assetIssuer
        );
        if (match) {
          setTrustlineStatus({
            loading: false,
            state: 'present',
            error: '',
            balance: match.assetBalance,
            limit: match.limit,
            isAuthorized: match.isAuthorized,
            isAuthorizedToMaintainLiabilities: match.isAuthorizedToMaintainLiabilities,
          });
        } else {
          setTrustlineStatus({ loading: false, state: 'missing', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setTrustlineStatus({
          loading: false,
          state: 'error',
          error: err?.message || 'error.loadTrustlines',
          balance: null,
          limit: null,
          isAuthorized: null,
          isAuthorizedToMaintainLiabilities: null,
        });
      });
    return () => { cancelled = true; };
  }, [accountId, network, selectedAsset, trustlineRefreshToken]);

  useEffect(() => {
    setTrustlineLimit(DEFAULT_TRUSTLINE_LIMIT);
  }, [selectedAsset, network]);

  return {
    trustlineStatus,
    setTrustlineStatus,
    trustlineLimit,
    setTrustlineLimit,
    trustlineRefreshToken,
    setTrustlineRefreshToken,
  };
}
