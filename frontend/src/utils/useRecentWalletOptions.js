import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTrustedWallets } from './useTrustedWallets.js';
import { createWalletInfoMap, findWalletInfo } from './walletInfo.js';
import { isTestnetAccount } from './stellar/accountUtils.js';

function normalizeStoredWallet(entry) {
  if (typeof entry === 'string') {
    return { publicKey: entry, isTestnet: false };
  }
  if (!entry || typeof entry !== 'object') return null;
  const pk = entry.publicKey || entry.address || entry.value || '';
  if (!pk) return null;
  return { publicKey: pk, isTestnet: typeof entry.isTestnet === 'boolean' ? entry.isTestnet : undefined };
}

function loadRecentWalletsFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem('recentWallets') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeStoredWallet).filter(Boolean);
  } catch {
    return [];
  }
}

export function useRecentWalletOptions() {
  const { wallets } = useTrustedWallets();
  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);
  const [recentWallets, setRecentWallets] = useState(() => loadRecentWalletsFromStorage());
  const persistRecent = useCallback((list) => {
    try { localStorage.setItem('recentWallets', JSON.stringify(list)); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function ensureRecentFlags() {
      if (!recentWallets.some((entry) => entry && typeof entry.isTestnet === 'undefined')) return;
      try {
        const annotated = await Promise.all(recentWallets.map(async (entry) => {
          if (!entry || typeof entry.isTestnet !== 'undefined') return entry;
          let isTestnet = false;
          try {
            isTestnet = await isTestnetAccount(entry.publicKey);
          } catch {
            isTestnet = false;
          }
          return { ...entry, isTestnet };
        }));
        const changed = annotated.some((entry, idx) => (entry?.isTestnet !== recentWallets[idx]?.isTestnet));
        if (!cancelled && changed) {
          setRecentWallets(annotated);
          persistRecent(annotated);
        }
      } catch { /* noop */ }
    }
    ensureRecentFlags();
    return () => { cancelled = true; };
  }, [recentWallets, persistRecent]);

  const recentWalletOptions = useMemo(() => {
    return recentWallets
      .map((entry) => {
        const publicKey = entry?.publicKey || '';
        if (!publicKey) return null;
        const info = findWalletInfo(walletInfoMap, publicKey) || {};
        return {
          value: publicKey,
          label: info.label || '',
          isTestnet: !!entry?.isTestnet,
        };
      })
      .filter(Boolean);
  }, [recentWallets, walletInfoMap]);

  return { recentWalletOptions, recentWallets };
}
