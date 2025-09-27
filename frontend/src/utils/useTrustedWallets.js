// src/utils/useTrustedWallets.js
import { useEffect, useMemo, useState, useCallback } from 'react';
import defaultTrusted from '../../settings/QSI_TrustedWallets.json';

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

  const setWallets = useCallback((next) => {
    setError('');
    try {
      const shape = { wallets: Array.isArray(next) ? next : (next?.wallets ?? []) };
      setData(shape);
    } catch (e) {
      setError(e?.message || 'settings.trustedWallets.editor.parseError');
    }
  }, []);

  const setRawJson = useCallback((jsonText) => {
    setError('');
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || !Array.isArray(parsed.wallets)) {
        throw new Error('settings.trustedWallets.editor.invalidFormat');
      }
      setData(parsed);
      return { ok: true };
    } catch (e) {
      setError(e?.message || 'settings.trustedWallets.editor.parseError');
      return { ok: false, error: e?.message };
    }
  }, []);

  const resetToDefault = useCallback(() => {
    setError('');
    setData(defaultTrusted || { wallets: [] });
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  }, []);

  const exportFile = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'QSI_TrustedWallets.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
      setData(parsed);
      return { ok: true };
    } catch (e) {
      const msg = e?.message || 'settings.trustedWallets.editor.parseError';
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  return { data, wallets, setWallets, setRawJson, resetToDefault, exportFile, importFile, error };
}

export default useTrustedWallets;
