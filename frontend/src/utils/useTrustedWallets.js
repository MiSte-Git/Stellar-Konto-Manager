// src/utils/useTrustedWallets.js
import { useEffect, useMemo, useState, useCallback } from 'react';
const defaultTrusted = { wallets: [] };
import { isTestnetAccount } from './stellar/accountUtils.js';

const LS_KEY = 'stm_trusted_wallets';

export function useTrustedWallets() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* noop */ }
    return defaultTrusted || { wallets: [] };
  });
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch { /* noop */ }
  }, [data]);

  const wallets = useMemo(() => Array.isArray(data?.wallets) ? data.wallets : [], [data]);

  // Enriches wallet entries with the testnet flag while defaulting to false on failure.
  const loadAccountsWithTestnetFlag = useCallback(async (list = []) => {
    return Promise.all(list.map(async (wallet) => {
      if (!wallet || typeof wallet !== 'object') return wallet;
      if (typeof wallet.isTestnet !== 'undefined') return wallet;
      const address = String(wallet.address || wallet.publicKey || '').trim();
      let isTestnet = false;
      if (address) {
        try {
          isTestnet = await isTestnetAccount(address);
        } catch {
          isTestnet = false;
        }
      }
      return { ...wallet, isTestnet };
    }));
  }, []);

  const setWallets = useCallback(async (next) => {
    setError('');
    try {
      const incoming = Array.isArray(next) ? next : (next?.wallets ?? []);
      const annotated = await loadAccountsWithTestnetFlag(incoming);
      const shape = { wallets: annotated };
      setData(shape);
    } catch (e) {
      setError(e?.message || 'settings.trustedWallets.editor.parseError');
    }
  }, [loadAccountsWithTestnetFlag]);

  useEffect(() => {
    let cancelled = false;
    async function ensureFlags() {
      const list = Array.isArray(data?.wallets) ? data.wallets : [];
      if (!list.some((wallet) => typeof wallet?.isTestnet === 'undefined')) return;
      try {
        const annotated = await loadAccountsWithTestnetFlag(list);
        if (!cancelled) {
          setData((prev) => ({ ...(prev || {}), wallets: annotated }));
        }
      } catch {
        // swallow: defaults remain false
      }
    }
    ensureFlags();
    return () => {
      cancelled = true;
    };
  }, [data, loadAccountsWithTestnetFlag]);

  const setRawJson = useCallback(async (jsonText) => {
    setError('');
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || !Array.isArray(parsed.wallets)) {
        throw new Error('settings.trustedWallets.editor.invalidFormat');
      }
      await setWallets(parsed.wallets);
      return { ok: true };
    } catch (e) {
      setError(e?.message || 'settings.trustedWallets.editor.parseError');
      return { ok: false, error: e?.message };
    }
  }, [setWallets]);

  const resetToDefault = useCallback(() => {
    setError('');
    const next = defaultTrusted?.wallets || [];
    setWallets(next);
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  }, [setWallets]);

  const exportFile = useCallback((filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = String(filename || 'QSI_TrustedWallets.json');
    document.body.appendChild(a);
    a.click();
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url);
  }, [data]);

  const importFile = useCallback(async (file) => {
    setError('');
    if (!file) return { ok: false, error: 'no_file' };
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.wallets)) {
        throw new Error('settings.trustedWallets.editor.invalidFormat');
      }
      await setWallets(parsed.wallets);
      return { ok: true };
    } catch (e) {
      const msg = e?.message || 'settings.trustedWallets.editor.parseError';
      setError(msg);
      return { ok: false, error: msg };
    }
  }, [setWallets]);

  return { data, wallets, setWallets, setRawJson, resetToDefault, exportFile, importFile, error };
}

export default useTrustedWallets;
