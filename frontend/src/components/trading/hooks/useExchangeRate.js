import { useEffect, useRef, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { deriveOrderbookMidRate, bestPathDestinationAmount } from '../assetSearchUtils.js';

const REFERENCE_AMOUNT = '1';

export const EMPTY_EXCHANGE_RATE = {
  loading: false,
  loadedAt: null,
  orderbook: { xlmToToken: null, tokenToXlm: null, error: '' },
  execution: { xlmToToken: null, tokenToXlm: null, error: '' },
};

/**
 * Live XLM <-> token reference rate for the token currently shown in the
 * "Token suchen" details panel (1 XLM = x TOKEN and 1 TOKEN = x XLM).
 *
 * Deliberately independent of the swap form's amount/direction/trustline
 * state (SwapSection's marketData/quoteDetails cover that separate,
 * amount-driven workflow) - this is a read-only quote for whichever token is
 * selected, so it has to work before an amount is entered, before a
 * trustline exists, and regardless of swap direction. Neither Horizon call
 * needs an account or trustline.
 *
 * Two independent sources, each surfaced only as what Horizon actually
 * returned (token trust principle - no implied endorsement, no hidden
 * fallback when data is missing):
 *  - orderbook: mid of best bid/ask from the native DEX order book.
 *  - execution: a strict-send path quote for a 1-unit reference amount, i.e.
 *    what a small swap would actually execute at right now (can differ from
 *    the order-book mid once multi-hop paths or AMM pools are involved).
 * A larger swap amount can execute at a worse rate than either number here
 * (slippage) - this widget is a reference point, not a guaranteed price.
 */
export default function useExchangeRate({ selectedStellarAsset, network, enabled }) {
  const [exchangeRate, setExchangeRate] = useState(EMPTY_EXCHANGE_RATE);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled || !selectedStellarAsset || selectedStellarAsset.isNative()) {
      setExchangeRate(EMPTY_EXCHANGE_RATE);
      return undefined;
    }

    const requestId = ++requestRef.current;
    const isStale = () => requestRef.current !== requestId;

    const load = async () => {
      setExchangeRate({ ...EMPTY_EXCHANGE_RATE, loading: true });
      const server = getHorizonServer(
        network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org'
      );

      const [orderbookResult, xlmToTokenResult, tokenToXlmResult] = await Promise.allSettled([
        server.orderbook(Asset.native(), selectedStellarAsset).call(),
        server.strictSendPaths(Asset.native(), REFERENCE_AMOUNT, [selectedStellarAsset]).call(),
        server.strictSendPaths(selectedStellarAsset, REFERENCE_AMOUNT, [Asset.native()]).call(),
      ]);
      if (isStale()) return;

      let orderbook;
      if (orderbookResult.status === 'fulfilled') {
        const { baseToCounter, counterToBase } = deriveOrderbookMidRate(orderbookResult.value);
        orderbook = {
          xlmToToken: baseToCounter,
          tokenToXlm: counterToBase,
          error: baseToCounter == null ? 'noLiquidity' : '',
        };
      } else {
        orderbook = { xlmToToken: null, tokenToXlm: null, error: 'failed' };
      }

      const xlmToToken = xlmToTokenResult.status === 'fulfilled'
        ? bestPathDestinationAmount(xlmToTokenResult.value)
        : null;
      const tokenToXlm = tokenToXlmResult.status === 'fulfilled'
        ? bestPathDestinationAmount(tokenToXlmResult.value)
        : null;
      const execution = {
        xlmToToken,
        tokenToXlm,
        error: xlmToToken == null && tokenToXlm == null ? 'noRoute' : '',
      };

      setExchangeRate({ loading: false, loadedAt: Date.now(), orderbook, execution });
    };

    load();
    return undefined;
  }, [enabled, selectedStellarAsset, network]);

  return exchangeRate;
}
