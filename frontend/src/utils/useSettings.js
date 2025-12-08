// Speichert kleine UI-Settings (z. B. Cache-Switch) in localStorage.
import { useState, useEffect } from 'react';
import defaultExplorers from '../config/defaultExplorers.json';

const KEY_EXPLORERS = 'stm.explorers';
const KEY_DEFAULT_EXPLORER = 'stm.defaultExplorerKey';
// Feedback lists are static and i18n-driven; add new entries here plus translations (Settings-Tab removed for consistency).
export const KNOWN_FEEDBACK_CATEGORIES = [
  { id: 'bug', labelKey: 'common:feedback.categories.bug', fallback: 'Fehler' },
  { id: 'idea', labelKey: 'common:feedback.categories.idea', fallback: 'Idee' },
  { id: 'improve', labelKey: 'common:feedback.categories.improve', fallback: 'Verbesserung' },
  { id: 'other', labelKey: 'common:feedback.categories.other', fallback: 'Sonstiges' },
];
// Only explicitly defined areas are listed here; helper/tooltip texts (e.g., history info) are intentionally excluded.
export const KNOWN_FEEDBACK_AREAS = [
  { id: 'language-bar', labelKey: 'common:feedback.areaLabels.languageBar', fallback: 'Sprachleiste' },
  { id: 'create-account', labelKey: 'menu:createAccount', fallback: 'Konto erstellen + Multisig' },
  { id: 'send-payment', labelKey: 'menu:sendPayment', fallback: 'Zahlung senden' },
  { id: 'balance', labelKey: 'menu:balance', fallback: 'Kontoinformation' },
  { id: 'token-purchases', labelKey: 'menu:tokenPurchases', fallback: 'Token-Käufe' },
  { id: 'xlm-by-memo', labelKey: 'menu:xlmByMemo', fallback: 'XLM nach Memo filtern' },
  { id: 'trading-assets', labelKey: 'trading:assetSearch.title', fallback: 'Asset-Suche' },
  { id: 'multisig-edit', labelKey: 'menu:multisigEdit', fallback: 'Multisig bearbeiten' },
  { id: 'multisig-jobs', labelKey: 'menu:multisigJobs', fallback: 'Multisig-Jobs' },
  { id: 'muxed', labelKey: 'menu:muxed', fallback: 'Muxed-Adressen' },
  { id: 'trustlines-list', labelKey: 'menu:listAll', fallback: 'Trustlines auflisten' },
  { id: 'trustlines-compare', labelKey: 'menu:compareTrustlines', fallback: 'Trustlines vergleichen' },
  { id: 'feedback-form', labelKey: 'common:feedback.title', fallback: 'Feedback-Formular' },
  { id: 'glossary', labelKey: 'menu:glossary', fallback: 'Glossar' },
  { id: 'settings', labelKey: 'settings:label', fallback: 'Einstellungen' },
  { id: 'quiz', labelKey: 'settings:sections.quiz', fallback: 'Quiz & Lernen' },
];

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

  // Applies a snapshot from export/import to the current settings state (with validation/sanitization).
  const applySettingsSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('settings:import.error.invalidType');
    if (typeof snapshot.prefetchDays === 'number' && Number.isFinite(snapshot.prefetchDays)) {
      setPrefetchDays(snapshot.prefetchDays);
    }
    if (typeof snapshot.decimalsMode === 'string' && ['auto', '0', '1', '2', '3', '4', '5', '6', '7'].includes(snapshot.decimalsMode)) {
      setDecimalsMode(snapshot.decimalsMode);
    }
    if (typeof snapshot.fullHorizonUrl === 'string') setFullHorizonUrl(snapshot.fullHorizonUrl);
    if (typeof snapshot.autoUseFullHorizon === 'boolean') setAutoUseFullHorizon(snapshot.autoUseFullHorizon);
    if (Array.isArray(snapshot.explorers)) setExplorers(snapshot.explorers);
    if (typeof snapshot.defaultExplorer === 'string') setDefaultExplorer(snapshot.defaultExplorer);
  };

  return {
    prefetchDays, setPrefetchDays,
    decimalsMode, setDecimalsMode,
    fullHorizonUrl, setFullHorizonUrl,
    autoUseFullHorizon, setAutoUseFullHorizon,
    explorers,
    setExplorers,
    defaultExplorer: defaultExplorerKey,
    setDefaultExplorer,
    feedbackCategories: KNOWN_FEEDBACK_CATEGORIES,
    feedbackAreas: KNOWN_FEEDBACK_AREAS,
    availableFeedbackAreas: KNOWN_FEEDBACK_AREAS,
    getSettingsSnapshot,
    applySettingsSnapshot,
  };
}
