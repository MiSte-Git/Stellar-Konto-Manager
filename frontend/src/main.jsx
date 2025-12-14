// import trustlineLogo from './assets/Trustline-Logo.jpg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Link } from 'react-router-dom';
import { BACKEND_URL } from './config';
import { 
  loadTrustlines, 
  handleSourceSubmit as submitSourceInput,
  getHorizonServer,
  getAccountSummary
 } from './utils/stellar/stellarUtils.js';
import { useTrustedWallets } from './utils/useTrustedWallets.js';
import { createWalletInfoMap, findWalletInfo } from './utils/walletInfo.js';
import { isTestnetAccount } from './utils/stellar/accountUtils.js';
import { buildPath, quizLandingPath } from './utils/basePath.js';

function migrateLegacyStorageKeys() {
  if (typeof window === 'undefined') return;
  try {
    const ls = window.localStorage;
    const ss = window.sessionStorage;

    if (ls.getItem('STM_NETWORK') && !ls.getItem('SKM_NETWORK')) {
      ls.setItem('SKM_NETWORK', ls.getItem('STM_NETWORK'));
    }
    if (ls.getItem('STM_HORIZON_URL') && !ls.getItem('SKM_HORIZON_URL')) {
      ls.setItem('SKM_HORIZON_URL', ls.getItem('STM_HORIZON_URL'));
    }
    if (ls.getItem('STM_NET_INIT') && !ls.getItem('SKM_NET_INIT')) {
      ls.setItem('SKM_NET_INIT', ls.getItem('STM_NET_INIT'));
    }

    if (ss.getItem('STM_PREV_PATH') && !ss.getItem('SKM_PREV_PATH')) {
      ss.setItem('SKM_PREV_PATH', ss.getItem('STM_PREV_PATH'));
    }

    ls.removeItem('STM_NETWORK');
    ls.removeItem('STM_HORIZON_URL');
    ls.removeItem('STM_NET_INIT');
    ss.removeItem('STM_PREV_PATH');
  } catch (e) {
    /* noop */
  }
}

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
import App from './App.jsx';
import { confirmAutoClear } from './utils/confirmAutoClear.js';
import ActivateAccountPrompt from './components/ActivateAccountPrompt.jsx';
import { emitAccountSelected } from './utils/accountBus.js';

import DestinationInput from './components/DestinationInput';
import MainMenu from './components/MainMenu';
import ListTrustlines from './components/ListTrustlines';
import ResultDisplay from './components/ResultDisplay';
import CompareTrustlines from './components/CompareTrustlines';
import DeleteAllTrustlines from './components/DeleteAllTrustlines';
import DeleteByIssuer from './components/DeleteByIssuer';
import ConfirmationModal from './components/ConfirmationModal';
import './index.css'; // Enthält @tailwind + dein echtes Styling
import {
  toggleAllTrustlines,
  toggleTrustlineSelection
} from './utils/stellar/trustlineUtils';
import { 
  handleSort
} from './utils/uiHelpers.js';
import XlmByMemoPanel from './components/XlmByMemoPanel';
import XlmByMemoPage from './pages/XlmByMemoPage';
import InvestedTokensPage from './pages/InvestedTokensPage';
import SettingsPage from './pages/SettingsPage.jsx';
import MultisigCreatePage from './pages/MultisigCreatePage.jsx';
import MultisigEditPage from './pages/MultisigEditPage.jsx';
import BalancePage from './pages/BalancePage.jsx';
import SendPaymentPage from './pages/SendPaymentPage.jsx';
import FeedbackPage from './pages/FeedbackPage.jsx';
import MuxedAccountsPage from './pages/MuxedAccountsPage.jsx';
import MultisigJobList from './pages/MultisigJobList.jsx';
import TradingAssetsPage from './pages/TradingAssetsPage.jsx';


migrateLegacyStorageKeys();
confirmAutoClear();

if (typeof window !== 'undefined') {
  window.stmSelectAccount = (address, opts) => emitAccountSelected(address, { forceReload: !!(opts && opts.force) });
}

// Ensure default network is PUBLIC on first load only; avoid re-emitting during remounts in dev
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const alreadyInit = window.localStorage.getItem('SKM_NET_INIT') === '1';
    if (!alreadyInit) {
      window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
      window.localStorage.setItem('SKM_NET_INIT', '1');
      window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' }));
    }
  }
} catch { /* noop */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <>
      <ActivateAccountPrompt />
      <App />
    </>
  </React.StrictMode>
);

function Main() {
	//console.log('main.jsx In function Main');
  const { t } = useTranslation(['common', 'quiz', 'learn', 'glossary', 'legal']);
  const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;
  const { wallets } = useTrustedWallets();
  //console.log('[DEBUG] Aktive Horizon URL:', HORIZON_URL);
  // Innerhalb der Main-Funktion (nach useState-Aufrufen):
  const [trustlines, setTrustlines] = useState([]);
  const [trustlinesOwner, setTrustlinesOwner] = useState('');
  const [selectedTrustlines, setSelectedTrustlines] = useState([]);
  const [filters, setFilters] = useState({ assetCode: '', assetIssuer: '', createdAt: '', zeroOnly: false });
  const [sortColumn, setSortColumn] = useState('assetCode');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(0);
  const ITEMS_PER_PAGE = 333;const [menuSelection, setMenuSelection] = useState(null);

  const [sourcePublicKey, setSourcePublicKey] = useState('');
  const [sourceSecret, setSourceSecret] = useState('');
  const [destinationPublicKey, setDestinationPublicKey] = useState('');
  const [issuerAddress, setIssuerAddress] = useState('');
  // Globaler Header: Wallet-Selector (Komfortvariante)
  const [recentWallets, setRecentWallets] = useState(() => loadRecentWalletsFromStorage());
  
  const [walletHeaderInput, setWalletHeaderInput] = useState('');
  // Trustlines und Secret Keys werden nur für Backend-Operationen aktualisiert, aber nicht gerendert
  // Deshalb setzen wir nur setTrustlines, lesen aber trustlines nicht aus → ignorierbare Warnung
  const [, setShowSecretKey] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showSecretInfo, setShowSecretInfo] = useState(false);
  // Dev/Testnet toggle state synced with localStorage
  const [devTestnet, setDevTestnet] = useState(false);
   // Send Payment initial values (e.g., for donation)
  const [sendInit, setSendInit] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
   // Session secret key presence
   const [hasSessionKey, setHasSessionKey] = useState(false);
   const [xlmBalance, setXlmBalance] = useState(null);
   const [xlmBalanceLoading, setXlmBalanceLoading] = useState(false);

  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);
  const trimmedHeaderInput = (walletHeaderInput || '').trim();
  const headerWalletInfo = findWalletInfo(walletInfoMap, trimmedHeaderInput) || findWalletInfo(walletInfoMap, sourcePublicKey);
  const headerFederationDisplay = trimmedHeaderInput && trimmedHeaderInput.includes('*')
    ? trimmedHeaderInput
    : (headerWalletInfo?.federation || '');
  const headerLabel = headerWalletInfo?.label || '';
  const headerCompromised = !!headerWalletInfo?.compromised;
  const headerDeactivated = !!headerWalletInfo?.deactivated;
  useEffect(() => {
    // Do not force network again here; App.jsx listens and shows banner
    try {
      const v = window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC';
      setDevTestnet(v === 'TESTNET');
    } catch { /* noop */ }
  }, []);

   // Track if a session secret exists for current source key
   useEffect(() => {
   try {
   if (!sourcePublicKey) { setHasSessionKey(false); return; }
   const v = sessionStorage.getItem(`stm.session.secret.${sourcePublicKey}`);
   setHasSessionKey(!!v);
   } catch { setHasSessionKey(false); }
   }, [sourcePublicKey]);

   // React to session secret changes (e.g., after entering secret in modal)
   useEffect(() => {
   const handler = (e) => {
   try {
     const pk = (e && e.detail && e.detail.publicKey) ? e.detail.publicKey : sourcePublicKey;
       if (!pk) { setHasSessionKey(false); return; }
         const v = sessionStorage.getItem(`stm.session.secret.${pk}`);
         setHasSessionKey(!!v);
       } catch { /* noop */ }
     };
     window.addEventListener('stm-session-secret-changed', handler);
     return () => window.removeEventListener('stm-session-secret-changed', handler);
   }, [sourcePublicKey]);
 
   const clearSessionSecret = () => {
     try {
       if (sourcePublicKey) sessionStorage.removeItem(`stm.session.secret.${sourcePublicKey}`);
       setHasSessionKey(false);
       setInfoMessage(t('secretKey:cleared'));
     } catch { /* noop */ }
   };


   

  const handleSortClick = (column) => {
    handleSort(column, sortColumn, sortDirection, setSortColumn, setSortDirection);
  };
  const handleFilterUpdate = (key, value) => {
    handleFilterChange(key, value, filters, setFilters, setCurrentPage);
  };

  const handleToggleTrustline = (tl) => {
    if (parseFloat(tl.assetBalance) !== 0) return;
    setSelectedTrustlines(prev => {
      const next = toggleTrustlineSelection(tl, prev);
      try {
        const wasSelected = prev.some(s => s.assetCode === tl.assetCode && s.assetIssuer === tl.assetIssuer);
        console.debug('[Toggle One]', tl.assetCode, tl.assetIssuer, 'wasSelected?', wasSelected, '-> newLen', next.length);
      } catch { /* noop */ }
      return next;
    });
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const [infoMessage, setInfoMessage] = useState('');

  // Auto-hide info messages
  useEffect(() => {
    if (!infoMessage) return;
    const id = setTimeout(() => setInfoMessage(''), 4000);
    return () => clearTimeout(id);
  }, [infoMessage]);

  // Clear info on new transaction start
  useEffect(() => {
    const handler = () => setInfoMessage('');
    window.addEventListener('stm-transaction-start', handler);
    return () => window.removeEventListener('stm-transaction-start', handler);
  }, []);

  // Clear info block whenever page changes or account switches
  useEffect(() => { setInfoMessage(''); }, [menuSelection]);
  useEffect(() => { setInfoMessage(''); }, [sourcePublicKey]);
 
   // Kürzlich verwendete Wallets aus localStorage laden
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

  const addRecent = useCallback((pk) => {
    const trimmed = (pk || '').trim();
    if (!trimmed) return;
    setRecentWallets(prev => {
      const filtered = prev.filter(entry => entry?.publicKey !== trimmed);
      const next = [{ publicKey: trimmed, isTestnet: undefined }, ...filtered].slice(0, 20);
      persistRecent(next);
      return next;
    });
  }, [persistRecent]);

  async function fetchXlmBalanceFor(pk, net) {
    if (!pk) { setXlmBalance(null); return; }
    try {
      setXlmBalanceLoading(true);
      const server = net === 'TESTNET'
        ? getHorizonServer('https://horizon-testnet.stellar.org')
        : getHorizonServer('https://horizon.stellar.org');
      const summary = await getAccountSummary(pk, server);
      setXlmBalance(summary?.xlmBalance ?? null);
    } catch {
      // Unfunded or error → null
      setXlmBalance(null);
    } finally {
      setXlmBalanceLoading(false);
    }
  }

  async function handleHeaderApply() {
    const input = (walletHeaderInput || '').trim();
    if (!input) return;
    setIsLoading(true);
    setError('');
    try {
      // Phase 1: nur leichte Konto-Zusammenfassung (verhindert Burst beim bloßen Laden)
      const { publicKey, summary } = await submitSourceInput(input, t, devTestnet ? 'TESTNET' : 'PUBLIC', { includeTrustlines: false });
      setSourcePublicKey(publicKey);
      // XLM direkt aus summary
      setXlmBalance(summary?.xlmBalance ?? null);
      addRecent(publicKey);
      setNotFound(false);
      setRefreshToken(prev => prev + 1);
      // Trustlines werden erst geladen, wenn der Nutzer „Alle anzeigen“ oder andere Funktionen öffnet
    } catch (err) {
      const msg = String(err?.message || '');
      setError(msg);
      setNotFound(/nicht gefunden|not found/i.test(msg));
    } finally {
      setIsLoading(false);
    }
  }

  // Revalidate active wallet when other parts toggle network
  const revalidateActiveWallet = useCallback(async () => {
    if (!sourcePublicKey) return;
    setIsLoading(true);
    setError('');
    try {
      const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
      // Nur leichte Zusammenfassung nach Netzwechsel neu laden
      const { publicKey, summary } = await submitSourceInput(sourcePublicKey, t, net, { includeTrustlines: false });
      setSourcePublicKey(publicKey);
      setXlmBalance(summary?.xlmBalance ?? null);
      setNotFound(false);
      setRefreshToken(prev => prev + 1);
    } catch (err) {
      const msg = String(err?.message || '');
      setError(msg);
      setNotFound(/nicht gefunden|not found/i.test(msg));
    } finally {
      setIsLoading(false);
    }
  }, [sourcePublicKey, t]);

  useEffect(() => {
    const handler = () => { revalidateActiveWallet(); };
    window.addEventListener('stm-trigger-recheck', handler);
    return () => window.removeEventListener('stm-trigger-recheck', handler);
  }, [revalidateActiveWallet]);

  // Keep header checkbox (devTestnet) in sync with global network changes
  useEffect(() => {
    const handler = (e) => {
      const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC');
      setDevTestnet(v === 'TESTNET');
      setInfoMessage('');
      try { if (sourcePublicKey) fetchXlmBalanceFor(sourcePublicKey, v === 'TESTNET' ? 'TESTNET' : 'PUBLIC'); } catch { /* noop */ }
      // Invalidate trustlines cache owner on network change
      setTrustlinesOwner('');
    };
    window.addEventListener('stm-network-changed', handler);
    // Initialize once from storage without emitting
    try { const v = window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC'; setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    return () => window.removeEventListener('stm-network-changed', handler);
  }, [sourcePublicKey]);

  // Listen for settings open requests from the language bar
  useEffect(() => {
    const openSettings = () => setMenuSelection('settings');
    window.addEventListener('stm:openSettings', openSettings);
    return () => window.removeEventListener('stm:openSettings', openSettings);
  }, []);

  // Listen for menu open requests from the language bar (e.g., feedback, donate)
  useEffect(() => {
    const openMenu = (e) => {
      const target = typeof e?.detail === 'string' ? e.detail : '';
      if (target === 'feedback') {
        setMenuSelection('feedback');
      } else if (target === 'donate') {
        setSendInit({
          recipient: 'GBXKZ5LITZS5COXM5275MQCTRKEK5M2UVR3GARY35OKH32WUMVL67X7M',
          amount: 5,
          memoText: `Spende ${t('common:main.title')}`,
        });
        setMenuSelection('sendPayment');
      }
    };
    window.addEventListener('stm:openMenu', openMenu);
    return () => window.removeEventListener('stm:openMenu', openMenu);
  }, [t, setMenuSelection, setSendInit]);

  // Lazy-load trustlines when needed by specific views
  useEffect(() => {
    const needsTrustlines = ['listAll','compare','deleteAll','deleteByIssuer'].includes(menuSelection);
    if (!needsTrustlines) return;
    if (!sourcePublicKey) return;
    if (trustlinesOwner === sourcePublicKey && trustlines.length >= 0) {
      // Already loaded for this account (including empty list)
      return;
    }
    setIsLoading(true);
    (async () => {
      try {
        const server = devTestnet
          ? getHorizonServer('https://horizon-testnet.stellar.org')
          : getHorizonServer('https://horizon.stellar.org');
        const tls = await loadTrustlines(sourcePublicKey, server);
        setTrustlines(tls);
        setTrustlinesOwner(sourcePublicKey);
      } catch (e) {
        setError(String(e?.message || ''));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [menuSelection, sourcePublicKey, devTestnet, trustlinesOwner, trustlines.length]);

  function unloadActiveWallet() {
    setSourcePublicKey('');
    setTrustlines([]);
    setTrustlinesOwner('');
    setSelectedTrustlines([]);
    setResults([]);
    setDestinationPublicKey('');
    setIssuerAddress('');
    setError('');
    setXlmBalance(null);
  }

  function handleRecentDelete() {
    const key = (walletHeaderInput || '').trim();
    if (!key) return;
    setRecentWallets(prev => {
      const next = prev.filter(entry => entry.publicKey !== key);
      persistRecent(next);
      return next;
    });
    // Falls der geladene Key dem gelöschten entspricht: entladen
    if (sourcePublicKey && sourcePublicKey === key) {
      unloadActiveWallet();
    }
  }

  // Aktuelle Wallet automatisch in "Zuletzt verwendet" aufnehmen
  useEffect(() => {
    if (sourcePublicKey) addRecent(sourcePublicKey);
  }, [sourcePublicKey, addRecent]);

  // Global error handler
  useEffect(() => {
    const handleError = (message, source, lineno, colno, error) => {
      console.error('Global error:', { message, source, lineno, colno, error });
      setError(`Script error: ${message} at ${source}:${lineno}:${colno}${error ? ' - ' + error.message : ''}`);
      return true; // Prevent default browser error handling
    };
    window.onerror = handleError;
    return () => { window.onerror = null; };
  }, []);

  // Handle scroll for Back to Top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 200);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    console.log('[menuSelection]', JSON.stringify(menuSelection));
    console.debug('[DEBUG] useEffect check: menuSelection is', menuSelection);
  }, [menuSelection]);

  const errorDisplay = React.useMemo(() => {
    const raw = String(error || '');
    if (!raw) return '';
    const base = t('submitTransaction:failed', 'Transaction failed');
    if (raw.startsWith('submitTransaction.failed:')) {
      const detail = raw.slice('submitTransaction.failed:'.length);
      return base + ': ' + t(detail, detail);
    }
    return t(raw, raw);
  }, [error, t]);

  // Filter-Update
  function handleFilterChange(key, value) {
    setFilters({ ...filters, [key]: value });
    setCurrentPage(0); // Bei Filterwechsel auf Seite 1 zurück
  }

  // Alle auf aktueller Seite toggeln
  const handleToggleAll = (paginatedList) => {
    const next = toggleAllTrustlines(paginatedList, selectedTrustlines);
    // Debug
    try {
      const deletable = paginatedList.filter(t => parseFloat(t.assetBalance) === 0).length;
      console.debug('[Toggle All] pageItems', paginatedList.length, 'deletable', deletable, 'before', selectedTrustlines.length, 'after', next.length);
    } catch { /* noop */ }
    setSelectedTrustlines(next);
  };

  const navigateTo = (subpath) => {
    try {
      const cleanSubpath = String(subpath).trim().replace(/^\/+/, '');
      const url = buildPath(cleanSubpath);
      if (typeof window !== 'undefined') {
        if (window.sessionStorage) {
          window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname);
        }
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (err) {
        console.error('navigateTo failed', err);
    }
  };

  return (
     <>
      <div className="max-w-4xl mx-auto px-4 pt-4 text-center mt-4-500" style={{ paddingBottom: 'max(1rem, calc(2rem + env(safe-area-inset-bottom)))' }}>
        {/* 🌍 Global: Titel & Info */}
        <div className="relative mb-2">
          <h1 className="text-2xl font-bold text-center">{t('common:main.title')}</h1>
          {/* Active network banner */}
          <div className="mt-2 text-xs text-center">
            <span className={`inline-block px-2 py-0.5 rounded font-semibold ${devTestnet ? 'bg-yellow-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
              {devTestnet ? t('network:testnet') : t('network:mainnet')}
            </span>
          </div>
          {/* Action buttons unter dem Titel (gemeinsame Zeile) */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    const url = quizLandingPath(1);
                    if (typeof window !== 'undefined') {
                      if (window.sessionStorage) {
                        window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname);
                      }
                      window.history.pushState({}, '', url);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }
                  } catch { /* noop */ }
                }}
                title={t('learn:menu', 'Stellar-Quiz für Anfänger')}
                className="inline-flex items-center gap-1 sm:gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-0.5 md:px-3 md:py-1 text-[11px] sm:text-xs md:text-sm rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <span aria-hidden>★</span>
                <span>{t('learn:menu', 'Stellar-Quiz für Anfänger')}</span>
              </button>
              <button
                type="button"
                onClick={() => navigateTo('learn')}
                title={t('learn:menuHint', 'Lernübersicht')}
                className="inline-flex items-center gap-1 sm:gap-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 px-2.5 py-0.5 md:px-3 md:py-1 text-[11px] sm:text-xs md:text-sm rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <span aria-hidden>↗</span>
                <span>{t('learn:menuHint', 'Lernübersicht')}</span>
              </button>
              <button
                type="button"
                onClick={() => navigateTo('glossar')}
                title={t('glossary:pageTitle', 'Glossar')}
                className="inline-flex items-center gap-1 sm:gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-0.5 md:px-3 md:py-1 text-[11px] sm:text-xs md:text-sm rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <span aria-hidden>ℹ</span>
                <span>{t('glossary:pageTitle', 'Glossar')}</span>
              </button>
            </div>
          </div>
          {infoMessage && (
            <div className="mt-2 text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-2 inline-block">
              {infoMessage}
            </div>
          )}
        </div>
        <p className="mb-2 text-sm text-blue-200 rounded border">
          {t('secretKey:info')}
          <button type="button" onClick={()=>setShowSecretInfo(true)} className="ml-2 px-2 py-0.5 text-blue-700 underline">
            {t('createAccount:info.more')}
          </button>
        </p>
        {/* Fixierter Wallet-Header – immer sichtbar */}
        <div className="sticky top-0 z-30 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b rounded-b px-3 py-2 mb-2">
          <form onSubmit={(e) => { e.preventDefault(); handleHeaderApply(); }} className="max-w-4xl mx-auto mb-0">
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-sm">{t('publicKey:label')}</label>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={devTestnet}
                  onChange={(e)=>{ const next = !!e.target.checked; setDevTestnet(next); if (typeof window !== 'undefined' && window.localStorage) { if (next) { window.localStorage.setItem('SKM_NETWORK', 'TESTNET'); window.localStorage.setItem('SKM_HORIZON_URL', 'https://horizon-testnet.stellar.org'); } else { window.localStorage.setItem('SKM_NETWORK', 'PUBLIC'); window.localStorage.removeItem('SKM_HORIZON_URL'); } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: next ? 'TESTNET' : 'PUBLIC' })); } }}
                />
                {t('menu:devTestnet', 'Testnet (für Entwickler)')}
              </label>
            </div>
            <div className="relative">
              <input
                type="text"
                list="recent-wallets"
                value={walletHeaderInput}
                onChange={(e) => setWalletHeaderInput(e.target.value)}
                placeholder={t('publicKey:placeholder')}
                className={`wallet-input w-full border ${notFound ? 'border-red-500 ring-1 ring-red-400' : (devTestnet ? 'border-yellow-500 ring-1 ring-yellow-400' : 'border-gray-300')} rounded p-2 pr-8 font-mono text-base md:text-sm`}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                inputMode="text"
              />
              {walletHeaderInput && (
                <button
                  type="button"
                  onClick={() => { setWalletHeaderInput(''); unloadActiveWallet(); setDevTestnet(false); if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem('SKM_NETWORK', 'PUBLIC'); window.localStorage.removeItem('SKM_HORIZON_URL'); window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); } }}
                  title={t('common:clear')}
                  aria-label={t('common:clear')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center"
                >
                  ×
                </button>
              )}
              <datalist id="recent-wallets">
                {recentWallets.map((entry, i) => (
                  <option
                    key={`${entry.publicKey}-${i}`}
                    value={entry.publicKey}
                    label={entry.isTestnet ? t('common:account.testnetLabel', 'Testnet') : undefined}
                  />
                ))}
              </datalist>

            </div>
            <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1">
                {/* Links: Föderationsadresse & Label linksbündig */}
                <div className="min-w-0 space-y-0.5 text-left">
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.label', 'Föderationsadresse')}:</span>{' '}
                    {headerFederationDisplay
                      ? <span className="font-mono break-all">{headerFederationDisplay}</span>
                      : <span className="italic text-gray-500">{t('wallet:federationDisplay.none', 'Keine Föderationsadresse definiert')}</span>}
                  </div>
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.accountLabel', 'Label')}:</span>{' '}
                    {headerLabel ? headerLabel : <span className="text-gray-400">—</span>}
                  </div>

                  {headerCompromised && (
                    <div className="text-red-600 dark:text-red-400 font-semibold">
                      {t('wallet:flag.compromised', 'Warning: This wallet is marked as compromised in your trusted list.')}
                    </div>
                  )}

                  {headerDeactivated && (
                    <div className="text-amber-600 dark:text-amber-400 font-medium">
                      {t('wallet:flag.deactivated', 'Note: This wallet is marked as deactivated in your trusted list.')}
                    </div>
                  )}
                </div>

                {/* Rechts: XLM-Kontostand als Label (rechtsbündig), ohne Überlagerung auf Mobil */}
                <div className="text-right">
                  <span className="font-semibold">{t('wallet:xlmBalance', 'XLM')}:</span>{' '}
                  <span className="font-mono">
                    {xlmBalanceLoading
                      ? t('common:loading', 'Loading…')
                      : (sourcePublicKey
                          ? (xlmBalance != null ? `${xlmBalance}` : t('wallet:unfunded', 'Unfunded'))
                          : '—')}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 justify-start">
              {/* Linke Buttons */}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading || !walletHeaderInput.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                  title="Wallet übernehmen"
                >
                  {t('publicKey:load')}
                </button>
                <button
                  type="button"
                  onClick={handleRecentDelete}
                  disabled={isLoading || !recentWallets.some((entry) => entry.publicKey === (walletHeaderInput || '').trim())}
                  className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t('publicKey:deleteFromList')}
                </button>
              </div>
              {/* Rechte Buttons */}
              <div className="flex items-center gap-2 ml-auto">
                {hasSessionKey && (
                  <button
                    type="button"
                    onClick={clearSessionSecret}
                    className="px-3 py-2 rounded bg-green-600 text-white border border-red-600 hover:bg-green-700"
                    title={t('secretKey:clearSessionHint')}
                  >
                    {t('secretKey:clearSession')}
                  </button>
                )}
                {menuSelection && (
                  <button
                    type="button"
                    onClick={() => setMenuSelection(null)}
                    className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('navigation:backToMainMenu')}
                  </button>
                )}
              </div>
            </div>

          </form>
        </div>
        {sourcePublicKey && (
          <>
            <p className="mb-1 pb-1 text-sm text-gray-700 dark:text-gray-200 font-mono break-all">
              {t('publicKey:source')}: {sourcePublicKey}
            </p>
            {notFound && (
              <div className="text-center text-xs text-red-700 mb-3 inline-block border border-red-500 rounded px-2 py-0.5">
                {t('errors:accountNotFoundInNetwork', { net: devTestnet ? 'Testnet' : 'Mainnet' })}
              </div>
            )}
          </>
        )}

        {/* Menüauswahl sichtbar, unabhängig davon ob ein Wallet gesetzt ist */}
        {!menuSelection && (
          <MainMenu
            onSelect={(value) => {
              const next = (value ?? '').trim();
              console.log('[MainMenu onSelect]', JSON.stringify(next));
              if (next === 'donate') {
                setSendInit({ recipient: 'GBXKZ5LITZS5COXM5275MQCTRKEK5M2UVR3GARY35OKH32WUMVL67X7M', amount: 5, memoText: `Spende ${t('common:main.title')}` });
                setMenuSelection('sendPayment');
              } else {
                setSendInit(null);
                setMenuSelection(next);
              }
            }}
          />
        )}

        {error && <p className="text-red-500 mt-4">{errorDisplay}</p>}
      </div>

      {/* Menüansicht anzeigen (z.B. ListAll) */}
      {menuSelection === 'listAll' && (
        sourcePublicKey ? (
          <div className="max-w-6xl mx-auto px-3">
            {error && <p className="text-sm text-gray-400">{errorDisplay}</p>}
            <ListTrustlines
              key={refreshToken}
              trustlines={trustlines}
              itemsPerPage={ITEMS_PER_PAGE}
              currentPage={currentPage}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSortClick}
              filters={filters}
              onFilterChange={handleFilterUpdate}
              selectedTrustlines={selectedTrustlines}
              setSelectedTrustlines={setSelectedTrustlines}
              onToggleTrustline={handleToggleTrustline}
              onToggleAll={handleToggleAll}
              results={results}
              setResults={setResults}
              setMenuSelection={setMenuSelection}
              menuSelection={menuSelection}
              setSecretKey={setSourceSecret}
              publicKey={sourcePublicKey}
              setTrustlines={setTrustlines}
              setIsProcessing={setIsProcessing}
              isProcessing={isProcessing}
              deleteProgress={deleteProgress}
              setDeleteProgress={setDeleteProgress}
              setInfoMessage={setInfoMessage}
            />
          </div>
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('trustline:all')}</h2></div>
            {t('investedTokens:hintEnterPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'compare' && (
        sourcePublicKey ? (
          <div className="max-w-6xl mx-auto px-3">
            <CompareTrustlines
              key={refreshToken}
              sourcePublicKey={sourcePublicKey}
              sourceSecret={sourceSecret}
              destinationPublicKey={destinationPublicKey}
              setDestinationPublicKey={setDestinationPublicKey}
              setResults={setResults}
              setError={setError}
              setShowSecretKey={setShowSecretKey}
              setSourceSecret={setSourceSecret}
              setMenuSelection={setMenuSelection}
              menuSelection={menuSelection}
              setTrustlines={setTrustlines}
              setConfirmAction={setConfirmAction}
              setShowConfirm={setShowConfirm}
              loadTrustlines={loadTrustlines}
              backendUrl={BACKEND_URL}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          </div>
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('trustline:compare')}</h2></div>
            {t('investedTokens:hintEnterPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'deleteAll' && (
        <DeleteAllTrustlines
          key={refreshToken}
          sourcePublicKey={sourcePublicKey}
          sourceSecret={sourceSecret}
          setSourceSecret={setSourceSecret}
          setShowSecretKey={setShowSecretKey}
          setTrustlines={setTrustlines}
          setResults={setResults}
          setError={setError}
          backendUrl={BACKEND_URL}
          setShowConfirm={setShowConfirm}
          setConfirmAction={setConfirmAction}
          loadTrustlines={loadTrustlines}
          setIsLoading={setIsLoading}
        />
      )}
      {menuSelection === 'deleteByIssuer' && (
        <DeleteByIssuer
          key={refreshToken}
          issuerAddress={issuerAddress}
          setIssuerAddress={setIssuerAddress}
          sourcePublicKey={sourcePublicKey}
          sourceSecret={sourceSecret}
          setSourceSecret={setSourceSecret}
          setShowSecretKey={setShowSecretKey}
          setTrustlines={setTrustlines}
          setResults={setResults}
          setError={setError}
          setConfirmAction={setConfirmAction}
          setShowConfirm={setShowConfirm}
          loadTrustlines={loadTrustlines}
          backendUrl={BACKEND_URL}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}
      {menuSelection === 'xlmByMemo' && (
        sourcePublicKey ? (
          <XlmByMemoPage
            key={refreshToken}
            publicKey={sourcePublicKey}
            onBack={() => setMenuSelection(null)}  // oder null, wie du magst
          />
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('xlmByMemo:page.title')}</h2></div>
            {t('xlmByMemo:page.noPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'payments' && (
        <div className="max-w-6xl mx-auto px-3">
          <InvestedTokensPage
            key={refreshToken}
            publicKey={sourcePublicKey}
            onBack={() => setMenuSelection(null)}
          />
        </div>
      )}
      {menuSelection === 'tradingAssets' && (
        <div className="max-w-6xl mx-auto px-3">
          <TradingAssetsPage />
        </div>
      )}
      {menuSelection === 'balance' && (
        <BalancePage
          key={refreshToken}
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}
      {menuSelection === 'sendPayment' && (
        <SendPaymentPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
          initial={sendInit}
        />
      )}
      {menuSelection === 'muxed' && (
        <MuxedAccountsPage publicKey={sourcePublicKey} onBack={() => setMenuSelection(null)} />
      )}
      {menuSelection === 'feedback' && (
        <div className="max-w-6xl mx-auto px-3">
          <FeedbackPage onBack={() => setMenuSelection(null)} />
        </div>
      )}
      {menuSelection === 'settings' && (
        <SettingsPage
          key={refreshToken}
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}
      {menuSelection === 'createAccount' && (
        <MultisigCreatePage />
      )}
      {menuSelection === 'multisigEdit' && (
        <MultisigEditPage key={refreshToken} defaultPublicKey={sourcePublicKey} />
      )}
      {menuSelection === 'multisigJobs' && (
        <div className="max-w-5xl mx-auto px-3">
          <MultisigJobList onBack={() => setMenuSelection(null)} />
        </div>
      )}
       
       {menuSelection &&
       !['listAll','compare','deleteAll','deleteByIssuer','xlmByMemo','payments','settings','createAccount','multisigEdit','multisigJobs','balance','sendPayment','feedback','muxed'].includes(menuSelection) && (
         <div className="p-3 text-sm text-red-600">
           {t('menu:unknown', { value: String(menuSelection) }, 'Unbekannte Menüauswahl')}
         </div>
      )}

     {results.length > 0 && (
        <ResultDisplay
          results={results}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSortClick}
          currentPage={currentPage}
          itemsPerPage={ITEMS_PER_PAGE}
        />
      )}

      <div className="mt-8 text-center text-xs text-gray-600 dark:text-gray-300">
        <Link to="/legal" className="hover:underline">
          {t('legal:footer.imprintLink')}
        </Link>
      </div>

      {showBackToTop && !showConfirm && !showSecretInfo && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed right-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 z-20 shadow-lg"
          style={{ bottom: 'max(4rem, calc(4rem + env(safe-area-inset-bottom)))' }}
          aria-label={t('navigation:backToTop')}
        >
          {t('navigation:backToTop')}
        </button>
      )}
      {showConfirm && (
        <ConfirmationModal
          confirmAction={confirmAction}
          setShowConfirm={setShowConfirm}
          setError={setError}
          setSourceSecret={setSourceSecret}
          setShowSecretKey={setShowSecretKey}
          setIsLoading={setIsLoading}
          setResults={setResults}
          isLoading={isLoading}
        />
      )}
      

      {showSecretInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-6 max-w-md w-full mx-auto">
            <h4 className="text-lg font-bold mb-3">{t('createAccount:info.keysOnPage.title')}</h4>
            <p className="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">{t('createAccount:info.keysOnPage.text')}</p>
            <div className="text-right mt-6">
              <button onClick={()=>setShowSecretInfo(false)} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">{t('common:close')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Main;
