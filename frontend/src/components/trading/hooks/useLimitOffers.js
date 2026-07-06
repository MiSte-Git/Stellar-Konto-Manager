import { useEffect, useState } from 'react';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';

/**
 * Limit-order (manageSellOffer) state: direction/amount/price form fields,
 * the account's own open offers, and a refresh token to re-fetch them.
 * Extracted from AssetSearch.jsx (step 5 of the file-split, hook 1/6).
 *
 * pendingOfferAction/showOfferConfirm/isSubmittingOffer stay in the
 * container - they're the offer confirm-dialog's own state, feeding
 * beginAction's payload (see useTradingSubmit, step 6), not limit-order-
 * specific state on their own. Correspondingly, the original
 * combined reset effect (AssetSearch.jsx, before this extraction: resetting
 * limitOfferAmount/limitOfferPrice/pendingOfferAction/showOfferConfirm
 * together on [selectedAsset, network]) is split: this hook only resets the
 * two fields it owns; the container keeps a smaller effect resetting
 * pendingOfferAction/showOfferConfirm.
 */
export default function useLimitOffers({ selectedAsset, accountId, network }) {
  const [limitOfferDirection, setLimitOfferDirection] = useState('sell-token-for-xlm');
  const [limitOfferAmount, setLimitOfferAmount] = useState('');
  const [limitOfferPrice, setLimitOfferPrice] = useState('');
  const [limitOfferStatus, setLimitOfferStatus] = useState({ loading: false, error: '', offers: [] });
  const [limitOfferRefreshToken, setLimitOfferRefreshToken] = useState(0);

  useEffect(() => {
    setLimitOfferAmount('');
    setLimitOfferPrice('');
  }, [selectedAsset, network]);

  useEffect(() => {
    let cancelled = false;
    if (!accountId || !selectedAsset) {
      setLimitOfferStatus({ loading: false, error: '', offers: [] });
      return () => { cancelled = true; };
    }

    const loadOffers = async () => {
      setLimitOfferStatus((current) => ({ ...current, loading: true, error: '' }));
      try {
        const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
        const response = await server.offers().forAccount(accountId).limit(30).call();
        if (!cancelled) {
          setLimitOfferStatus({
            loading: false,
            error: '',
            offers: Array.isArray(response?.records) ? response.records : [],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLimitOfferStatus({
            loading: false,
            error: error?.message || 'offerLoadFailed',
            offers: [],
          });
        }
      }
    };

    loadOffers();
    return () => { cancelled = true; };
  }, [accountId, limitOfferRefreshToken, network, selectedAsset]);

  return {
    limitOfferDirection,
    setLimitOfferDirection,
    limitOfferAmount,
    setLimitOfferAmount,
    limitOfferPrice,
    setLimitOfferPrice,
    limitOfferStatus,
    limitOfferRefreshToken,
    setLimitOfferRefreshToken,
  };
}
