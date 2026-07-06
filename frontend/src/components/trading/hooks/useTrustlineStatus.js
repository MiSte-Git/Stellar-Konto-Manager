import { useEffect, useState } from 'react';
import { getHorizonServer, loadTrustlines } from '../../../utils/stellar/stellarUtils.js';
import { DEFAULT_TRUSTLINE_LIMIT } from '../assetSearchUtils.js';

/**
 * Trustline status for the selected asset: present/missing/error/loading,
 * balance/limit/authorization when present, the "add trustline" limit form
 * field, and a refresh token to re-check after a submitted change. Extracted
 * from AssetSearch.jsx (step 5 of the file-split, hook 3/6).
 *
 * trustlineRefreshToken is returned (with its setter) because the
 * container's own accountInfo-loading effect (accountId/network are owned by
 * useTradingAccount, hook 6, but the effect itself stays in the container -
 * see that hook's file comment for why) also depends on it: a submitted
 * trustline change must refresh both the trustline check here and the
 * account's reserve/balance snapshot there.
 *
 * accountInput is taken as a parameter purely to reset trustlineStatus to
 * 'unknown' the instant the account input changes - previously done directly
 * by the container's accountInput-resolution effect (a foreign write into
 * this hook's state). Since useTradingAccount needs trustlineRefreshToken
 * (owned here) for its own accountInfo effect, and this hook needs
 * accountId/network/accountInput (owned there), extracting both hooks
 * without a cycle means each hook only ever calls its own setters - so this
 * reset moved here instead of staying a cross-hook setter call. The result
 * is unchanged: whenever accountInput changes, useTradingAccount transiently
 * sets accountId to '' and, in the same effect-flush, this hook's own
 * accountId-driven effect below reacts to that and settles on 'noAccount' -
 * exactly as when a single combined effect did both steps before this split.
 *
 * Reset cascade: the original combined [selectedAsset, network]-reset effect
 * (AssetSearch.jsx, before this extraction) also reset showTrustlineConfirm/
 * showTrustlineSwapConfirm and tokenFactsExpanded, neither of which belong to
 * trustline status. That effect is split further: this hook takes over only
 * the trustlineLimit reset; the container keeps the rest (both step-6/
 * confirm-pipeline territory or a plain UI toggle with no fetch effect).
 */
export default function useTrustlineStatus({ accountId, network, accountInput, selectedAsset }) {
  const [trustlineStatus, setTrustlineStatus] = useState({ loading: false, state: 'unknown', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
  const [trustlineLimit, setTrustlineLimit] = useState(DEFAULT_TRUSTLINE_LIMIT);
  const [trustlineRefreshToken, setTrustlineRefreshToken] = useState(0);

  useEffect(() => {
    setTrustlineStatus({ loading: false, state: 'unknown', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
  }, [accountInput]);

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
