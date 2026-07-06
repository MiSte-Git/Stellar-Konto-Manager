import { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/apiBase.js';
import { assetResultKey } from '../assetSearchUtils.js';

/**
 * Asset search state: the query field, search results, per-result domain/
 * TOML facts (fetched with a small worker pool), sort order, and the
 * currently selected asset. Extracted from AssetSearch.jsx (step 5 of the
 * file-split, hook 5/6).
 *
 * selectedAsset lives here (not its own hook) because "select a result" is
 * the natural conclusion of a search - every other extracted hook
 * (useTrustlineStatus, useSwapPreview, useAssetFacts, useLimitOffers) takes
 * it as a parameter instead of owning it.
 *
 * No reset-cascade decision was needed here: none of the three original
 * combined [selectedAsset, network]-reset effects touched assetQuery/
 * assetResults/assetResultFacts/assetSort/assetError/assetLoading - only the
 * *other* hooks reset themselves in reaction to a selectedAsset change made
 * here. This hook's own per-result facts effect already guarded itself on
 * assetResults being empty, unchanged by this extraction.
 */
export default function useAssetSearch({ network }) {
  const [assetQuery, setAssetQuery] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  const [assetResultFacts, setAssetResultFacts] = useState({});
  const [assetSort, setAssetSort] = useState({ field: 'quality', direction: 'desc' });
  const [assetError, setAssetError] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!assetResults.length) {
      setAssetResultFacts({});
      return () => { cancelled = true; };
    }

    const initialFacts = {};
    assetResults.forEach((asset) => {
      initialFacts[assetResultKey(asset)] = { loading: true, homeDomain: false, tomlListed: false, error: '' };
    });
    setAssetResultFacts(initialFacts);

    const loadFactsForAsset = async (asset) => {
      const key = assetResultKey(asset);
      try {
        const params = new URLSearchParams({
          code: asset.assetCode,
          issuer: asset.assetIssuer,
          network,
        });
        const response = await fetch(`${apiUrl('trade/assets/facts')}?${params.toString()}`);
        const facts = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(facts?.error || 'assetFacts.failed:generic');
        if (cancelled) return;
        const homeDomain = Boolean(facts?.issuerAccount?.homeDomain || facts?.issuerAccount?.home_domain);
        const tomlListed = facts?.toml?.status === 'loaded' && Array.isArray(facts?.toml?.matches) && facts.toml.matches.length > 0;
        setAssetResultFacts((current) => ({
          ...current,
          [key]: { loading: false, homeDomain, tomlListed, error: '' },
        }));
      } catch (error) {
        if (cancelled) return;
        setAssetResultFacts((current) => ({
          ...current,
          [key]: { loading: false, homeDomain: false, tomlListed: false, error: error?.message || 'assetFacts.failed:generic' },
        }));
      }
    };

    const queue = [...assetResults];
    const workerCount = Math.min(4, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length && !cancelled) {
        const asset = queue.shift();
        await loadFactsForAsset(asset);
      }
    });
    Promise.all(workers).catch(() => {});

    return () => { cancelled = true; };
  }, [assetResults, network]);

  return {
    assetQuery,
    setAssetQuery,
    assetResults,
    setAssetResults,
    assetResultFacts,
    setAssetResultFacts,
    assetSort,
    setAssetSort,
    assetError,
    setAssetError,
    assetLoading,
    setAssetLoading,
    selectedAsset,
    setSelectedAsset,
  };
}
