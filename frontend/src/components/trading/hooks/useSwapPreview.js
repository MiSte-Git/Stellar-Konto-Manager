import { useEffect, useRef, useState } from 'react';

/**
 * Market-swap state: direction, amount/slippage form fields, the
 * token-to-token target search (query/results/selection), the strict-send
 * path preview, and the orderbook/liquidity-pool market data. Extracted from
 * AssetSearch.jsx (step 5 of the file-split, hook 2/6).
 *
 * swapPreviewRequestRef is returned as-is (not just its value) because the
 * container's handleSwapPreview() increments/reads `.current` directly for
 * stale-response detection - that handler stays in the container (not an
 * effect, and tightly coupled to submitSwapTx/submitTrustlineAndSwapTx which
 * are part of the modalAction confirm/submit pipeline reserved for step 6).
 *
 * Reset cascade: the original combined [selectedAsset, network]-reset effect
 * (AssetSearch.jsx, before this extraction) also reset trustlineLimit,
 * showTrustlineConfirm/showTrustlineSwapConfirm, and tokenFactsExpanded -
 * none of which belong to swap preview. That effect is split: this hook only
 * takes over the swapDirection reset; the container keeps a (now smaller)
 * effect for the fields it or a later hook still owns. The existing
 * swapPreview/marketData reset effect (on [selectedAsset, network,
 * swapDirection, swapTargetQuery, selectedSwapTargetAsset]) moves in whole,
 * unchanged - kept as a plain effect rather than a key-remount because
 * swapPreview/marketData are read by three different consumers (SwapSection,
 * TrustlineSection's combined flow, and ConfirmActionModal), so there is no
 * single subtree whose remount would reset all of them consistently.
 */
export default function useSwapPreview({ selectedAsset, network }) {
  const [swapAmount, setSwapAmount] = useState('10');
  const [swapSlippage, setSwapSlippage] = useState('0.5');
  const [swapDirection, setSwapDirection] = useState('xlm-to-token');
  const [swapTargetQuery, setSwapTargetQuery] = useState('');
  const [swapTargetResults, setSwapTargetResults] = useState([]);
  const [swapTargetError, setSwapTargetError] = useState('');
  const [swapTargetLoading, setSwapTargetLoading] = useState(false);
  const [selectedSwapTargetAsset, setSelectedSwapTargetAsset] = useState(null);
  const [swapPreview, setSwapPreview] = useState({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
  const swapPreviewRequestRef = useRef(0);
  const [marketData, setMarketData] = useState({ loading: false, error: '', orderbook: null, liquidityPools: [], loadedAt: null });

  useEffect(() => {
    setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
    setMarketData({ loading: false, error: '', orderbook: null, liquidityPools: [], loadedAt: null });
  }, [selectedAsset, network, swapDirection, swapTargetQuery, selectedSwapTargetAsset]);

  useEffect(() => {
    setSwapDirection('xlm-to-token');
  }, [selectedAsset, network]);

  return {
    swapAmount,
    setSwapAmount,
    swapSlippage,
    setSwapSlippage,
    swapDirection,
    setSwapDirection,
    swapTargetQuery,
    setSwapTargetQuery,
    swapTargetResults,
    setSwapTargetResults,
    swapTargetError,
    setSwapTargetError,
    swapTargetLoading,
    setSwapTargetLoading,
    selectedSwapTargetAsset,
    setSelectedSwapTargetAsset,
    swapPreview,
    setSwapPreview,
    swapPreviewRequestRef,
    marketData,
    setMarketData,
  };
}
