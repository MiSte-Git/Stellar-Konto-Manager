import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/apiBase.js';
import { EMPTY_ASSET_FACTS, getAssetCode, getAssetIssuer } from '../assetSearchUtils.js';

/**
 * Token-facts (issuer account + TOML) for the selected asset and, for
 * token-to-token swaps, the swap target asset. Extracted from
 * AssetSearch.jsx (step 5 of the file-split, hook 4/6).
 *
 * No reset-cascade decision was needed here: unlike trustline/swap-preview,
 * assetFacts/targetAssetFacts were never part of the shared combined
 * [selectedAsset, network]-reset effect - each already resets itself inline
 * whenever its own effect's guard condition (no selectedAsset / not a
 * token-to-token target) is false, which is unchanged by this extraction.
 */
export default function useAssetFacts({ selectedAsset, network, targetStellarAsset, swapDirection }) {
  const [assetFacts, setAssetFacts] = useState(EMPTY_ASSET_FACTS);
  const [targetAssetFacts, setTargetAssetFacts] = useState(EMPTY_ASSET_FACTS);

  // Third-party StellarExpert directory hint. Fetched alongside the facts but
  // strictly non-blocking: any failure (rate limit, outage, bad JSON) degrades
  // to status 'unavailable' instead of throwing, so the token facts always
  // render even when stellar.expert is down.
  const loadExpertEntryForIssuer = useCallback(async (issuer) => {
    try {
      const params = new URLSearchParams({ issuer, network });
      const response = await fetch(`${apiUrl('trade/assets/expert')}?${params.toString()}`);
      const entry = await response.json().catch(() => null);
      if (!response.ok || !entry) return { ...EMPTY_ASSET_FACTS.expert, status: 'unavailable' };
      return {
        status: entry.status || 'unavailable',
        name: entry.name || '',
        domain: entry.domain || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
      };
    } catch {
      return { ...EMPTY_ASSET_FACTS.expert, status: 'unavailable' };
    }
  }, [network]);

  const loadAssetFactsForIdentity = useCallback(async ({ code, issuer }) => {
    const params = new URLSearchParams({ code, issuer, network });
    const [response, expert] = await Promise.all([
      fetch(`${apiUrl('trade/assets/facts')}?${params.toString()}`),
      loadExpertEntryForIssuer(issuer),
    ]);
    const facts = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(facts?.error || 'assetFacts.failed:generic');
    return {
      loading: false,
      error: '',
      issuerAccount: facts?.issuerAccount || null,
      toml: {
        status: facts?.toml?.status || 'notChecked',
        url: facts?.toml?.url || '',
        currencies: Array.isArray(facts?.toml?.currencies) ? facts.toml.currencies : [],
        matches: Array.isArray(facts?.toml?.matches) ? facts.toml.matches : [],
        error: facts?.toml?.error || '',
      },
      expert,
    };
  }, [network, loadExpertEntryForIssuer]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAsset?.assetIssuer) {
      setAssetFacts(EMPTY_ASSET_FACTS);
      return () => { cancelled = true; };
    }

    const loadFacts = async () => {
      setAssetFacts({ ...EMPTY_ASSET_FACTS, loading: true });
      try {
        const facts = await loadAssetFactsForIdentity({
          code: selectedAsset.assetCode,
          issuer: selectedAsset.assetIssuer,
        });
        if (cancelled) return;
        setAssetFacts(facts);
      } catch (error) {
        if (!cancelled) {
          setAssetFacts({
            ...EMPTY_ASSET_FACTS,
            loading: false,
            error: error?.message || 'issuerLoadFailed',
          });
        }
      }
    };

    loadFacts();
    return () => { cancelled = true; };
  }, [loadAssetFactsForIdentity, selectedAsset]);

  useEffect(() => {
    let cancelled = false;
    const code = getAssetCode(targetStellarAsset);
    const issuer = getAssetIssuer(targetStellarAsset);
    if (swapDirection !== 'token-to-token' || !code || !issuer) {
      setTargetAssetFacts(EMPTY_ASSET_FACTS);
      return () => { cancelled = true; };
    }

    const loadFacts = async () => {
      setTargetAssetFacts({ ...EMPTY_ASSET_FACTS, loading: true });
      try {
        const facts = await loadAssetFactsForIdentity({ code, issuer });
        if (!cancelled) setTargetAssetFacts(facts);
      } catch (error) {
        if (!cancelled) {
          setTargetAssetFacts({
            ...EMPTY_ASSET_FACTS,
            loading: false,
            error: error?.message || 'issuerLoadFailed',
          });
        }
      }
    };

    loadFacts();
    return () => { cancelled = true; };
  }, [loadAssetFactsForIdentity, targetStellarAsset, swapDirection]);

  return { assetFacts, setAssetFacts, targetAssetFacts, setTargetAssetFacts };
}
