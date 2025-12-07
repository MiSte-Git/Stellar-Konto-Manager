// Speichert kleine UI-Settings (z. B. Cache-Switch) in localStorage.
import { useState, useEffect } from 'react';
import defaultExplorers from '../config/defaultExplorers.json';

const KEY_EXPLORERS = 'stm.explorers';
const KEY_DEFAULT_EXPLORER = 'stm.defaultExplorerKey';

function sanitizeExplorer(item) {
  if (!item || typeof item !== 'object') return null;
  const key = String(item.key || item.id || item.name || '').trim();
  const name = String(item.name || item.key || '').trim();
  const urlTemplate = String(item.urlTemplate || item.url || '').trim();
  const txTemplate = String(item.txTemplate || '').trim();
  const testnetUrlTemplate = String(item.testnetUrlTemplate || '').trim();
  const testnetTxTemplate = String(item.testnetTxTemplate || '').trim();
  if (!key || !name || !urlTemplate) return null;
  return {
    key,
    name,
    urlTemplate,
    txTemplate: txTemplate || undefined,
    testnetUrlTemplate: testnetUrlTemplate || undefined,
    testnetTxTemplate: testnetTxTemplate || undefined,
  };
}

function mergeDefaultsWithSaved(saved, defaults) {
  const byKey = new Map();
  (defaults || []).forEach((d) => { if (d?.key) byKey.set(d.key, { ...d }); });
  (saved || []).forEach((s) => {
    if (s?.key) {
      const base = byKey.get(s.key) || {};
      byKey.set(s.key, { ...base, ...s });
    }
  });
  return Array.from(byKey.values());
}

function loadExplorers() {
  try {
    const raw = localStorage.getItem(KEY_EXPLORERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = parsed.map(sanitizeExplorer).filter(Boolean);
        return mergeDefaultsWithSaved(cleaned, defaultExplorers);
      }
    }
  } catch { /* noop */ }
  return mergeDefaultsWithSaved([], defaultExplorers);
}

export function useSettings() {
  const [prefetchDays, setPrefetchDays] = useState(() => Number(localStorage.getItem('stm.prefetchDays') || 90));
  const [decimalsMode, setDecimalsMode] = useState(() => localStorage.getItem('stm.decimalsMode') || 'auto'); // 'auto' | '0'..'7'
  const [fullHorizonUrl, setFullHorizonUrl] = useState(() => localStorage.getItem('stm.horizonFullUrl') || '');
  const [autoUseFullHorizon, setAutoUseFullHorizon] = useState(() => localStorage.getItem('stm.autoFullHorizon') === '1');
  const [explorers, setExplorersState] = useState(() => loadExplorers());
  const [defaultExplorerKey, setDefaultExplorerKey] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY_DEFAULT_EXPLORER);
      if (saved) return saved;
    } catch { /* noop */ }
    return (defaultExplorers && defaultExplorers[0]?.key) || '';
  });

  useEffect(() => localStorage.setItem('stm.prefetchDays', String(prefetchDays)), [prefetchDays]);
  useEffect(() => localStorage.setItem('stm.decimalsMode', String(decimalsMode)), [decimalsMode]);
  useEffect(() => localStorage.setItem('stm.horizonFullUrl', String(fullHorizonUrl || '')), [fullHorizonUrl]);
  useEffect(() => localStorage.setItem('stm.autoFullHorizon', autoUseFullHorizon ? '1' : '0'), [autoUseFullHorizon]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_EXPLORERS, JSON.stringify(explorers));
    } catch { /* noop */ }
  }, [explorers]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_DEFAULT_EXPLORER, String(defaultExplorerKey || ''));
    } catch { /* noop */ }
  }, [defaultExplorerKey]);

  const setExplorers = (next) => {
    const cleaned = Array.isArray(next) ? next.map(sanitizeExplorer).filter(Boolean) : [];
    const merged = mergeDefaultsWithSaved(cleaned, defaultExplorers);
    setExplorersState(merged);
    setDefaultExplorerKey((prev) => {
      if (prev && merged.some((e) => e.key === prev)) return prev;
      return merged[0]?.key || '';
    });
  };

  const setDefaultExplorer = (key) => {
    setDefaultExplorerKey((prev) => {
      if (!key) return prev;
      const exists = (explorers || []).some((e) => e.key === key || e.id === key);
      return exists ? key : prev;
    });
  };

  const getSettingsSnapshot = () => ({
    prefetchDays,
    decimalsMode,
    fullHorizonUrl,
    autoUseFullHorizon,
    explorers,
    defaultExplorer: defaultExplorerKey,
  });

  return {
    prefetchDays, setPrefetchDays,
    decimalsMode, setDecimalsMode,
    fullHorizonUrl, setFullHorizonUrl,
    autoUseFullHorizon, setAutoUseFullHorizon,
    explorers,
    setExplorers,
    defaultExplorer: defaultExplorerKey,
    setDefaultExplorer,
    getSettingsSnapshot,
  };
}
