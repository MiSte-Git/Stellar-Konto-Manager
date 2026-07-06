import { useEffect, useState } from 'react';
import { resolveOrValidateAccount } from '../../../utils/stellar/stellarUtils.js';
import { getStoredAccountInput, getStoredNetwork } from '../assetSearchUtils.js';

/**
 * The active account/network context: account input (address or muxed/
 * federation identifier), the resolved accountId, resolution status, and the
 * selected network - kept in sync with the rest of the app via the same
 * window events/localStorage keys as before (untouched by this extraction).
 * Extracted from AssetSearch.jsx (step 5 of the file-split, hook 6/6, last).
 *
 * accountInfo (the loaded Horizon account) is owned here too, but the effect
 * that loads it is NOT: it depends on trustlineRefreshToken, which is owned
 * by useTrustlineStatus - and useTrustlineStatus in turn needs accountId/
 * network/accountInput from this hook. Moving that effect into either hook
 * would create a real circular dependency (each hook needing the other's
 * output before it can be called). It stays in the container instead, which
 * calls this hook's setAccountInfo once both hooks' values are available -
 * see AssetSearch.jsx's own comment at that effect.
 */
export default function useTradingAccount({ t }) {
  const [accountInput, setAccountInput] = useState(() => getStoredAccountInput());
  const [accountId, setAccountId] = useState('');
  const [accountStatus, setAccountStatus] = useState({ loading: false, error: '' });
  const [accountInfo, setAccountInfo] = useState(null);
  const [network, setNetwork] = useState(() => getStoredNetwork());

  useEffect(() => {
    const syncAccount = (event) => {
      const next = String(event?.detail?.address || getStoredAccountInput() || '').trim();
      setAccountInput(next);
    };
    const syncNetwork = (event) => {
      const next = typeof event?.detail === 'string' ? event.detail : getStoredNetwork();
      setNetwork(next === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
    };
    window.addEventListener('stm:accountSelected', syncAccount);
    window.addEventListener('stm:accountChanged', syncAccount);
    window.addEventListener('stm-network-changed', syncNetwork);
    return () => {
      window.removeEventListener('stm:accountSelected', syncAccount);
      window.removeEventListener('stm:accountChanged', syncAccount);
      window.removeEventListener('stm-network-changed', syncNetwork);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const input = String(accountInput || '').trim();
    setAccountId('');
    setAccountInfo(null);
    if (!input) {
      setAccountStatus({ loading: false, error: '' });
      return () => { cancelled = true; };
    }
    setAccountStatus({ loading: true, error: '' });
    resolveOrValidateAccount(input)
      .then((resolved) => {
        if (cancelled) return;
        setAccountId(resolved.accountId || '');
        setAccountStatus({ loading: false, error: '' });
      })
      .catch(() => {
        if (cancelled) return;
        setAccountId('');
        setAccountStatus({ loading: false, error: t('trading:assetSearch.account.invalid') });
      });
    return () => { cancelled = true; };
  }, [accountInput, t]);

  return {
    accountInput,
    setAccountInput,
    accountId,
    setAccountId,
    accountStatus,
    setAccountStatus,
    accountInfo,
    setAccountInfo,
    network,
    setNetwork,
  };
}
