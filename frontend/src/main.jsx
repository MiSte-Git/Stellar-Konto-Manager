// import trustlineLogo from './assets/Trustline-Logo.jpg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Link } from 'react-router-dom';
import { BACKEND_URL } from './config';
import { 
  loadTrustlines, 
  handleSourceSubmit as submitSourceInput,
  getHorizonServer,
  getAccountSummary,
  resolveOrValidateAccount,
  extractBasePublicKeyFromMuxed,
  extractMuxedIdFromAddress
 } from './utils/stellar/stellarUtils.js';
import { useTrustedWallets } from './utils/useTrustedWallets.js';
import { createWalletInfoMap, findWalletInfo } from './utils/walletInfo.js';
import AddressDropdown from './components/AddressDropdown.jsx';
import { isTestnetAccount } from './utils/stellar/accountUtils.js';
import { requiresGAccount, isIdentityMode } from './utils/accountMode.js';
import { clearSessionSecrets, getSessionSecretCount, hasSessionSecrets } from './utils/sessionSecrets.js';

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
  } catch {
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
import MultisigJobDetail from './pages/MultisigJobDetail.jsx';
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

const XLM_PRICE_PAIRS = [
  { key: 'EUR', label: '€/XLM', currency: 'eur', symbol: '€' },
  { key: 'USD', label: '$/XLM', currency: 'usd', symbol: '$' },
  { key: 'CHF', label: 'CHF/XLM', currency: 'chf', symbol: 'CHF ' },
  { key: 'GBP', label: '£/XLM', currency: 'gbp', symbol: '£' },
  { key: 'RUB', label: '₽/XLM', currency: 'rub', symbol: '₽' },
];

const PricePairSelector = React.memo(function PricePairSelector({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-xs"
      aria-label="XLM price pair"
    >
      {XLM_PRICE_PAIRS.map((pair) => (
        <option key={pair.key} value={pair.key}>{pair.label}</option>
      ))}
    </select>
  );
});

function Main() {
	//console.log('main.jsx In function Main');
  const { t, i18n } = useTranslation(['common', 'quiz', 'learn', 'glossary', 'legal']);
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
  const autoRestoredRef = useRef(false);

  const [sourcePublicKey, setSourcePublicKey] = useState('');
  const [sourceMuxedAddress, setSourceMuxedAddress] = useState('');
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
  const [identityGuard, setIdentityGuard] = useState({ open: false, nextAction: '' });
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showSecretInfo, setShowSecretInfo] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  // Dev/Testnet toggle state synced with localStorage
  const [devTestnet, setDevTestnet] = useState(false);
   // Send Payment initial values (e.g., for donation)
  const [sendInit, setSendInit] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
   // Session secret key presence
   const [hasSessionKey, setHasSessionKey] = useState(false);
   const [xlmBalance, setXlmBalance] = useState(null);
   const [xlmBalanceLoading, setXlmBalanceLoading] = useState(false);
   const [selectedPricePair, setSelectedPricePair] = useState(XLM_PRICE_PAIRS[0]?.key || 'EUR');
   const [xlmPriceMap, setXlmPriceMap] = useState({});
   const [xlmPriceChangeMap, setXlmPriceChangeMap] = useState({});
   const [xlmPriceLoading, setXlmPriceLoading] = useState(false);
   const [xlmPriceError, setXlmPriceError] = useState('');
   const [xlmPriceLoaded, setXlmPriceLoaded] = useState(false);
   const [xlmPriceUpdatedAt, setXlmPriceUpdatedAt] = useState(null);

  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);
  const handlePricePairChange = useCallback((e) => {
    setSelectedPricePair(e.target.value);
  }, []);
  const activePricePair = useMemo(
    () => XLM_PRICE_PAIRS.find((pair) => pair.key === selectedPricePair) || XLM_PRICE_PAIRS[0],
    [selectedPricePair]
  );
  const xlmPriceValue = activePricePair ? xlmPriceMap?.[activePricePair.currency] : null;
  const xlmPriceChangeValue = activePricePair ? xlmPriceChangeMap?.[activePricePair.currency] : null;
  const priceLocale = useMemo(() => {
    if (typeof navigator !== 'undefined') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const navLang = navigator.language || '';
      if (tz === 'Europe/Zurich') {
        if (navLang.includes('-')) {
          const langBase = navLang.split('-')[0];
          return `${langBase}-CH`;
        }
        return navLang ? `${navLang}-CH` : 'de-CH';
      }
      if (navLang) return navLang;
    }
    return i18n?.language || 'de-DE';
  }, [i18n?.language]);
  const xlmPriceDisplay = useMemo(() => {
    if (xlmPriceValue == null || Number.isNaN(Number(xlmPriceValue))) return 'n/a';
    const formatter = new Intl.NumberFormat(priceLocale, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    return `${activePricePair?.symbol || ''}${formatter.format(Number(xlmPriceValue))}`;
  }, [activePricePair, priceLocale, xlmPriceValue]);
  const xlmPriceChangeDisplay = useMemo(() => {
    if (xlmPriceChangeValue == null || Number.isNaN(Number(xlmPriceChangeValue))) return null;
    const formatter = new Intl.NumberFormat(priceLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = Number(xlmPriceChangeValue) > 0 ? '+' : '';
    return `${sign}${formatter.format(Number(xlmPriceChangeValue))}%`;
  }, [priceLocale, xlmPriceChangeValue]);
  const xlmPriceTrend = useMemo(() => {
    if (xlmPriceChangeValue == null || Number.isNaN(Number(xlmPriceChangeValue))) return null;
    if (Number(xlmPriceChangeValue) > 0.05) return 'up';
    if (Number(xlmPriceChangeValue) < -0.05) return 'down';
    return 'flat';
  }, [xlmPriceChangeValue]);
  const xlmPriceUpdatedLabel = useMemo(() => {
    if (!xlmPriceUpdatedAt) return '';
    const formatter = new Intl.DateTimeFormat(priceLocale, { hour: '2-digit', minute: '2-digit' });
    return formatter.format(xlmPriceUpdatedAt);
  }, [priceLocale, xlmPriceUpdatedAt]);
  const trimmedHeaderInput = (walletHeaderInput || '').trim();
  const headerLookupKey = useMemo(() => {
    if (trimmedHeaderInput && trimmedHeaderInput.startsWith('M')) {
      try {
        return extractBasePublicKeyFromMuxed(trimmedHeaderInput);
      } catch {
        return trimmedHeaderInput;
      }
    }
    return trimmedHeaderInput || sourcePublicKey;
  }, [trimmedHeaderInput, sourcePublicKey]);
  const headerWalletInfo = findWalletInfo(walletInfoMap, headerLookupKey) || findWalletInfo(walletInfoMap, sourcePublicKey);
  const accountMode = useMemo(
    () => (isIdentityMode(sourceMuxedAddress) ? 'identity' : 'account'),
    [sourceMuxedAddress]
  );
  const sourceMuxedId = useMemo(() => {
    if (!sourceMuxedAddress) return '';
    try {
      return extractMuxedIdFromAddress(sourceMuxedAddress);
    } catch {
      return '';
    }
  }, [sourceMuxedAddress]);
  const recentWalletOptions = useMemo(() => {
    return recentWallets
      .map((entry) => {
        const publicKey = entry?.publicKey || '';
        if (!publicKey) return null;
        let lookupKey = publicKey;
        if (lookupKey.startsWith('M')) {
          try {
            lookupKey = extractBasePublicKeyFromMuxed(lookupKey);
          } catch {
            lookupKey = publicKey;
          }
        }
        const info = findWalletInfo(walletInfoMap, lookupKey) || {};
        return {
          value: publicKey,
          label: info.label || '',
          isTestnet: !!entry?.isTestnet,
        };
      })
      .filter(Boolean);
  }, [recentWallets, walletInfoMap]);
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
   if (!sourcePublicKey) { setHasSessionKey(false); setSessionSecretCount(0); return; }
   setHasSessionKey(hasSessionSecrets(sourcePublicKey));
   setSessionSecretCount(getSessionSecretCount(sourcePublicKey));
   } catch { setHasSessionKey(false); setSessionSecretCount(0); }
   }, [sourcePublicKey]);

   // React to session secret changes (e.g., after entering secret in modal)
   useEffect(() => {
   const handler = (e) => {
   try {
     const pk = (e && e.detail && e.detail.publicKey) ? e.detail.publicKey : sourcePublicKey;
       if (!pk) { setHasSessionKey(false); setSessionSecretCount(0); return; }
         setHasSessionKey(hasSessionSecrets(pk));
         setSessionSecretCount(getSessionSecretCount(pk));
       } catch { /* noop */ }
     };
     window.addEventListener('stm-session-secret-changed', handler);
     return () => window.removeEventListener('stm-session-secret-changed', handler);
   }, [sourcePublicKey]);
 
   const clearSessionSecret = () => {
     try {
       if (sourcePublicKey) clearSessionSecrets(sourcePublicKey);
       setHasSessionKey(false);
       setSessionSecretCount(0);
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
  const [sessionSecretCount, setSessionSecretCount] = useState(0);

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
          let baseKey = entry.publicKey;
          if (baseKey && baseKey.startsWith('M')) {
            try {
              baseKey = extractBasePublicKeyFromMuxed(baseKey);
            } catch {
              baseKey = entry.publicKey;
            }
          }
          try {
            isTestnet = await isTestnetAccount(baseKey);
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
      const resolved = await resolveOrValidateAccount(input);
      const displayInput = resolved.muxedAddress || resolved.accountId;
      // Phase 1: nur leichte Konto-Zusammenfassung (verhindert Burst beim bloßen Laden)
      const { publicKey, summary } = await submitSourceInput(resolved.accountId, t, devTestnet ? 'TESTNET' : 'PUBLIC', { includeTrustlines: false });
      setSourcePublicKey(publicKey);
      setSourceMuxedAddress(resolved.muxedAddress || '');
      setWalletHeaderInput(displayInput);
      try { window.localStorage?.setItem('SKM_LAST_ACCOUNT', displayInput); } catch { /* noop */ }
      // XLM direkt aus summary
      setXlmBalance(summary?.xlmBalance ?? null);
      addRecent(displayInput);
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

  const switchToBaseAccount = useCallback(() => {
    if (!sourcePublicKey) return;
    setSourceMuxedAddress('');
    setWalletHeaderInput(sourcePublicKey);
    try { window.localStorage?.setItem('SKM_LAST_ACCOUNT', sourcePublicKey); } catch { /* noop */ }
    addRecent(sourcePublicKey);
  }, [sourcePublicKey, addRecent]);

  const handleMenuSelect = useCallback((value) => {
    const next = (value ?? '').trim();
    if (!next) return;
    const actionTarget = next === 'donate' ? 'sendPayment' : next;
    if (isIdentityMode(sourceMuxedAddress) && requiresGAccount(actionTarget)) {
      setIdentityGuard({ open: true, nextAction: actionTarget });
      return;
    }
    if (next === 'donate') {
      setSendInit({ recipient: 'GBXKZ5LITZS5COXM5275MQCTRKEK5M2UVR3GARY35OKH32WUMVL67X7M', amount: 5, memoText: `Spende ${t('common:main.title')}` });
      setMenuSelection('sendPayment');
      return;
    }
    setSendInit(null);
    setMenuSelection(next);
  }, [sourceMuxedAddress, t, setSendInit, setMenuSelection]);

  const closeIdentityGuard = useCallback(() => {
    setIdentityGuard({ open: false, nextAction: '' });
  }, []);

  const confirmIdentityGuard = useCallback(() => {
    const next = identityGuard.nextAction;
    setIdentityGuard({ open: false, nextAction: '' });
    switchToBaseAccount();
    if (next) setMenuSelection(next);
  }, [identityGuard.nextAction, switchToBaseAccount, setMenuSelection]);

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
      if (target) handleMenuSelect(target);
    };
    window.addEventListener('stm:openMenu', openMenu);
    return () => window.removeEventListener('stm:openMenu', openMenu);
  }, [handleMenuSelect]);

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
    setSourceMuxedAddress('');
    try { window.localStorage?.removeItem('SKM_LAST_ACCOUNT'); } catch { /* noop */ }
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
    if ((sourceMuxedAddress && sourceMuxedAddress === key) || (sourcePublicKey && sourcePublicKey === key)) {
      unloadActiveWallet();
    }
  }

  // Aktuelle Wallet automatisch in "Zuletzt verwendet" aufnehmen
  useEffect(() => {
    if (sourcePublicKey || sourceMuxedAddress) {
      addRecent(sourceMuxedAddress || sourcePublicKey);
    }
  }, [sourcePublicKey, sourceMuxedAddress, addRecent]);

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

  // Auto-restore zuletzt geladenes Konto
  useEffect(() => {
    if (sourcePublicKey || autoRestoredRef.current) return;
    let stored = '';
    try { stored = window.localStorage?.getItem('SKM_LAST_ACCOUNT') || ''; } catch { stored = ''; }
    const trimmed = stored.trim();
    if (!trimmed) return;
    autoRestoredRef.current = true;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
        const resolved = await resolveOrValidateAccount(trimmed);
        const displayInput = resolved.muxedAddress || resolved.accountId;
        const { publicKey, summary } = await submitSourceInput(resolved.accountId, t, net, { includeTrustlines: false });
        setSourcePublicKey(publicKey);
        setSourceMuxedAddress(resolved.muxedAddress || '');
        setWalletHeaderInput(displayInput);
        setXlmBalance(summary?.xlmBalance ?? null);
        setNotFound(false);
        setRefreshToken(prev => prev + 1);
      } catch (err) {
        setError(String(err?.message || ''));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sourcePublicKey, t]);

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

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    const fetchPrices = async () => {
      if (!xlmPriceLoaded) setXlmPriceLoading(true);
      if (!xlmPriceLoaded) setXlmPriceError('');
      try {
        const currencies = XLM_PRICE_PAIRS.map((pair) => pair.currency).join(',');
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=${currencies}&include_24hr_change=true`, { signal: controller.signal });
        if (!res.ok) throw new Error('price.fetchFailed');
        const data = await res.json();
        if (!isActive) return;
        const raw = data?.stellar || {};
        const nextPriceMap = {};
        const nextChangeMap = {};
        XLM_PRICE_PAIRS.forEach((pair) => {
          nextPriceMap[pair.currency] = raw?.[pair.currency];
          nextChangeMap[pair.currency] = raw?.[`${pair.currency}_24h_change`];
        });
        setXlmPriceMap(nextPriceMap);
        setXlmPriceChangeMap(nextChangeMap);
        setXlmPriceLoaded(true);
        setXlmPriceUpdatedAt(new Date());
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (!isActive) return;
        if (!xlmPriceLoaded) setXlmPriceError(String(err?.message || 'price.fetchFailed'));
      } finally {
        if (isActive && !xlmPriceLoaded) setXlmPriceLoading(false);
      }
    };
    fetchPrices();
    const id = setInterval(fetchPrices, 60000);
    return () => {
      isActive = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

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

  return (
     <>
      <div className="max-w-4xl mx-auto px-4 pt-4 text-center mt-4-500" style={{ paddingBottom: 'max(1rem, calc(2rem + env(safe-area-inset-bottom)))' }}>
        {/* 🌍 Global: Titel & Info */}
        <div className="relative mb-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="hidden sm:block" />
            <h1 className="text-2xl font-bold text-center">{t('common:main.title')}</h1>
            <div className="flex flex-col items-center sm:items-end text-sm text-gray-800 dark:text-gray-200">
              <div className="flex items-center justify-center sm:justify-end gap-2">
                <PricePairSelector value={selectedPricePair} onChange={handlePricePairChange} />
                <span className="font-semibold tabular-nums min-w-[5.5rem] text-right" title={xlmPriceError ? String(xlmPriceError) : ''}>
                  {xlmPriceLoading ? '...' : xlmPriceDisplay}
                </span>
                <span
                  className={`text-xs tabular-nums ${xlmPriceTrend === 'up' ? 'text-green-600 dark:text-green-400' : xlmPriceTrend === 'down' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
                  title="24h"
                >
                  {xlmPriceChangeDisplay ? `${xlmPriceTrend === 'up' ? '▲' : xlmPriceTrend === 'down' ? '▼' : '•'} ${xlmPriceChangeDisplay}` : '—'}
                </span>
              </div>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                Quelle: CoinGecko{xlmPriceUpdatedLabel ? ` · aktualisiert ${xlmPriceUpdatedLabel}` : ''}
              </span>
            </div>
          </div>
          {/* Active network banner */}
          <div className="mt-2 text-xs text-center">
            <span className={`inline-block px-2 py-0.5 rounded font-semibold ${devTestnet ? 'bg-yellow-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
              {devTestnet ? t('network:testnet') : t('network:mainnet')}
            </span>
          </div>
          {sourcePublicKey && (
            <div className="mt-1 text-xs text-center">
              <span className={`inline-block px-2 py-0.5 rounded font-semibold ${accountMode === 'identity' ? 'bg-amber-200 text-amber-900' : 'bg-blue-100 text-blue-800'}`}>
                {accountMode === 'identity'
                  ? t('common:accountMode.identity', 'Muxed Identity')
                  : t('common:accountMode.account', 'G account')}
              </span>
            </div>
          )}
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
            <AddressDropdown
              value={walletHeaderInput}
              onChange={(next) => setWalletHeaderInput(next)}
              onSelect={(next) => setWalletHeaderInput(next)}
              placeholder={t('publicKey:placeholder')}
              options={recentWalletOptions}
              inputClassName={`wallet-input w-full border ${notFound ? 'border-red-500 ring-1 ring-red-400' : (devTestnet ? 'border-yellow-500 ring-1 ring-yellow-400' : 'border-gray-300')} rounded p-2 pr-8 font-mono text-base md:text-sm`}
              inputProps={{
                spellCheck: false,
                autoCorrect: 'off',
                autoCapitalize: 'off',
                autoComplete: 'off',
                inputMode: 'text',
              }}
              rightAdornment={walletHeaderInput ? (
                <button
                  type="button"
                  onClick={() => { setWalletHeaderInput(''); unloadActiveWallet(); setDevTestnet(false); if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem('SKM_NETWORK', 'PUBLIC'); window.localStorage.removeItem('SKM_HORIZON_URL'); window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); } }}
                  title={t('common:clear')}
                  aria-label={t('common:clear')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center"
                >
                  ×
                </button>
              ) : null}
            />
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
                  {sourceMuxedAddress && (
                    <div className="mt-1 space-y-0.5">
                      <div>
                        <span className="font-semibold">{t('common:accountMode.muxedAddress', 'Muxed address')}:</span>{' '}
                        <span className="font-mono break-all">{sourceMuxedAddress}</span>
                      </div>
                      <div>
                        <span className="font-semibold">{t('common:accountMode.baseAccount', 'Base G account')}:</span>{' '}
                        <span className="font-mono break-all">{sourcePublicKey}</span>
                      </div>
                      {sourceMuxedId && (
                        <div>
                          <span className="font-semibold">{t('common:accountMode.muxedId', 'Muxed ID')}:</span>{' '}
                          <span className="font-mono break-all">{sourceMuxedId}</span>
                        </div>
                      )}
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
                {sourceMuxedAddress && (
                  <button
                    type="button"
                    onClick={switchToBaseAccount}
                    className="px-3 py-2 rounded border border-amber-300 text-amber-900 hover:bg-amber-50 dark:hover:bg-gray-800"
                  >
                    {t('common:accountMode.switchToBase', 'Switch to base account')}
                  </button>
                )}
              </div>
              {/* Rechte Buttons */}
              <div className="flex items-center gap-2 ml-auto">
                {hasSessionKey && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={clearSessionSecret}
                      className="px-3 py-2 rounded bg-green-600 text-white border border-red-600 hover:bg-green-700"
                      title={t('secretKey:clearSessionHint')}
                    >
                      {t('secretKey:clearSession')}
                    </button>
                    {sessionSecretCount > 1 && (
                      <span className="text-xs text-gray-600 dark:text-gray-300">
                        {t('secretKey:sessionCount', { count: sessionSecretCount, defaultValue: '{{count}} S-Keys gespeichert' })}
                      </span>
                    )}
                  </div>
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
              handleMenuSelect(next);
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
          muxedAddress={sourceMuxedAddress}
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
          <MultisigJobList
            publicKey={sourcePublicKey}
            onBack={() => setMenuSelection(null)}
            onOpenDetail={(id) => setActiveJobId(id)}
          />
        </div>
      )}
       
       {menuSelection &&
       !['listAll','compare','deleteAll','deleteByIssuer','xlmByMemo','payments','tradingAssets','settings','createAccount','multisigEdit','multisigJobs','balance','sendPayment','feedback','muxed'].includes(menuSelection) && (
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

      {identityGuard.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-6 max-w-md w-full mx-auto">
            <h4 className="text-lg font-bold mb-3">
              {t('common:accountMode.guardTitle', 'Muxed identity is read-only')}
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              {t('common:accountMode.guardText', 'This action needs the base G account. Switch to the base account to continue.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeIdentityGuard}
                className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t('common:option.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={confirmIdentityGuard}
                className="px-4 py-2 rounded bg-amber-500 text-white hover:bg-amber-600"
              >
                {t('common:accountMode.switchToBase', 'Switch to base account')}
              </button>
            </div>
          </div>
        </div>
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
      {activeJobId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">{t('multisig:detail.title')}</div>
              <button
                type="button"
                className="text-sm px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setActiveJobId(null)}
              >
                {t('common:option.back', 'Zurück')}
              </button>
            </div>
            <div className="p-4">
              <MultisigJobDetail jobId={activeJobId} currentPublicKey={sourcePublicKey} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Main;
