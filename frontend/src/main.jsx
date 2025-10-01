// import trustlineLogo from './assets/Trustline-Logo.jpg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { BACKEND_URL } from './config';
import { 
  loadTrustlines, 
  handleSourceSubmit as submitSourceInput
 } from './utils/stellar/stellarUtils.js';
import App from './App.jsx';

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function Main() {
	//console.log('main.jsx In function Main');
  const { t } = useTranslation();
  const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;
  //console.log('[DEBUG] Aktive Horizon URL:', HORIZON_URL);
  // Innerhalb der Main-Funktion (nach useState-Aufrufen):
  const [trustlines, setTrustlines] = useState([]);
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
  const [recentWallets, setRecentWallets] = useState([]);
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
   // Session secret key presence
   const [hasSessionKey, setHasSessionKey] = useState(false);
  useEffect(() => {
  // Force default to PUBLIC at app start
  if (typeof window !== 'undefined' && window.localStorage) {
  window.localStorage.setItem('STM_NETWORK', 'PUBLIC');
  window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' }));
  }
  }, []);

   // Track if a session secret exists for current source key
   useEffect(() => {
     try {
       if (!sourcePublicKey) { setHasSessionKey(false); return; }
       const v = sessionStorage.getItem(`stm.session.secret.${sourcePublicKey}`);
       setHasSessionKey(!!v);
     } catch { setHasSessionKey(false); }
   }, [sourcePublicKey]);

   const clearSessionSecret = () => {
     try {
       if (sourcePublicKey) sessionStorage.removeItem(`stm.session.secret.${sourcePublicKey}`);
       setHasSessionKey(false);
       setInfoMessage(t('secretKey.cleared'));
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

  // Kürzlich verwendete Wallets aus localStorage laden
  useEffect(() => {
    try {
      const raw = localStorage.getItem('recentWallets');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setRecentWallets(arr.filter(x => typeof x === 'string'));
        }
      }
    } catch { /* noop */ }
  }, []);

  const persistRecent = useCallback((list) => {
    try { localStorage.setItem('recentWallets', JSON.stringify(list)); } catch { /* noop */ }
  }, []);
  const addRecent = useCallback((pk) => {
    if (!pk) return;
    setRecentWallets(prev => {
      const next = [pk, ...prev.filter(x => x !== pk)].slice(0, 20);
      persistRecent(next);
      return next;
    });
  }, [persistRecent]);

  async function handleHeaderApply() {
    const input = (walletHeaderInput || '').trim();
    if (!input) return;
    setIsLoading(true);
    setError('');
    try {
      const { publicKey, trustlines } = await submitSourceInput(input, t, devTestnet ? 'TESTNET' : 'PUBLIC');
      setSourcePublicKey(publicKey);
      if (Array.isArray(trustlines)) setTrustlines(trustlines);
      addRecent(publicKey);
      setNotFound(false);
    } catch (err) {
      const msg = String(err?.message || '');
      setError(msg);
      setNotFound(/nicht gefunden|not found/i.test(msg));
    } finally {
      setIsLoading(false);
    }
  }

  // Revalidate active wallet when other parts toggle network
  async function revalidateActiveWallet() {
    if (!sourcePublicKey) return;
    setIsLoading(true);
    setError('');
    try {
      const net = (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
      const { publicKey, trustlines } = await submitSourceInput(sourcePublicKey, t, net);
      setSourcePublicKey(publicKey);
      if (Array.isArray(trustlines)) setTrustlines(trustlines);
      setNotFound(false);
    } catch (err) {
      const msg = String(err?.message || '');
      setError(msg);
      setNotFound(/nicht gefunden|not found/i.test(msg));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handler = () => { revalidateActiveWallet(); };
    window.addEventListener('stm-trigger-recheck', handler);
    return () => window.removeEventListener('stm-trigger-recheck', handler);
  }, [sourcePublicKey]);

  // Keep header checkbox (devTestnet) in sync with global network changes
  useEffect(() => {
    const handler = (e) => {
      const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC');
      setDevTestnet(v === 'TESTNET');
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  function unloadActiveWallet() {
    setSourcePublicKey('');
    setTrustlines([]);
    setSelectedTrustlines([]);
    setResults([]);
    setDestinationPublicKey('');
    setIssuerAddress('');
    setError('');
  }

  function handleRecentDelete() {
    const key = (walletHeaderInput || '').trim();
    if (!key) return;
    setRecentWallets(prev => {
      const next = prev.filter(x => x !== key);
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
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-0 text-center mt-4-500">
        {/* 🌍 Global: Titel & Info */}
        <div className="relative mb-4">
          <h1 className="text-2xl font-bold text-center">{t('main.title')}</h1>
          <button
            type="button"
            onClick={() => { setSendInit({ recipient: 'GBXKZ5LITZS5COXM5275MQCTRKEK5M2UVR3GARY35OKH32WUMVL67X7M', amount: 5, memoText: `Spende ${t('main.title')}` }); setMenuSelection('sendPayment'); }}
            title={t('menu.donate')}
            className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-green-400"
          >
            <span aria-hidden>♥</span>
            <span>{t('menu.donate')}</span>
          </button>
        </div>
        <p className="mb-4 text-sm text-blue-200 rounded border">
          {t('secretKey.info')}
          <button type="button" onClick={()=>setShowSecretInfo(true)} className="ml-2 px-2 py-0.5 text-blue-700 underline">
            {t('multisigCreate.info.more')}
          </button>
        </p>
        {/* Fixierter Wallet-Header – immer sichtbar */}
        <div className="sticky top-0 z-30 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b rounded-b px-3 py-2 mb-3">
          <form onSubmit={(e) => { e.preventDefault(); handleHeaderApply(); }} className="max-w-4xl mx-auto mb-0">
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-sm">{t('publicKey.label')}</label>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={devTestnet}
                  onChange={(e)=>{ const next = !!e.target.checked; setDevTestnet(next); if (typeof window !== 'undefined' && window.localStorage) { if (next) { window.localStorage.setItem('STM_NETWORK', 'TESTNET'); window.localStorage.setItem('STM_HORIZON_URL', 'https://horizon-testnet.stellar.org'); } else { window.localStorage.setItem('STM_NETWORK', 'PUBLIC'); window.localStorage.removeItem('STM_HORIZON_URL'); } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: next ? 'TESTNET' : 'PUBLIC' })); } }}
                />
                {t('menu.devTestnet')}
              </label>
            </div>
            <div className="relative">
              <input
                type="text"
                list="recent-wallets"
                value={walletHeaderInput}
                onChange={(e) => setWalletHeaderInput(e.target.value)}
                placeholder={t('publicKey.placeholder')}
                className={`wallet-input w-full border ${notFound ? 'border-red-500 ring-1 ring-red-400' : (devTestnet ? 'border-yellow-500 ring-1 ring-yellow-400' : 'border-gray-300')} rounded p-2 pr-8 font-mono text-sm`}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                inputMode="text"
              />
              {walletHeaderInput && (
                <button
                  type="button"
                  onClick={() => { setWalletHeaderInput(''); unloadActiveWallet(); setDevTestnet(false); if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem('STM_NETWORK', 'PUBLIC'); window.localStorage.removeItem('STM_HORIZON_URL'); window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); } }}
                  title={t('common.clear')}
                  aria-label={t('common.clear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-xs flex items-center justify-center"
                >
                  ×
                </button>
              )}
              <datalist id="recent-wallets">
                {recentWallets.map((w, i) => (
                  <option key={w + i} value={w} />
                ))}
              </datalist>
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
                  {t('publicKey.load')}
                </button>
                <button
                  type="button"
                  onClick={handleRecentDelete}
                  disabled={isLoading || !recentWallets.includes((walletHeaderInput || '').trim())}
                  className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t('publicKey.deleteFromList')}
                </button>
              </div>
              {/* Rechte Buttons */}
              <div className="flex items-center gap-2 ml-auto">
                {hasSessionKey && (
                  <button
                    type="button"
                    onClick={clearSessionSecret}
                    className="px-3 py-2 rounded bg-green-600 text-white border border-red-600 hover:bg-green-700"
                    title={t('secretKey.clearSessionHint')}
                  >
                    {t('secretKey.clearSession')}
                  </button>
                )}
                {menuSelection && (
                  <button
                    type="button"
                    onClick={() => setMenuSelection(null)}
                    className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('navigation.backToMainMenu')}
                  </button>
                )}
              </div>
            </div>

          </form>
        </div>
        {sourcePublicKey && (
          <>
            <p className="mb-1 pb-1 text-sm text-gray-700 dark:text-gray-200 font-mono">
              {t('publicKey.source')}: {sourcePublicKey}
            </p>
            {notFound && (
              <div className="text-center text-xs text-red-700 mb-3 inline-block border border-red-500 rounded px-2 py-0.5">
                {t('error.accountNotFoundInNetwork', { net: devTestnet ? 'Testnet' : 'Mainnet' })}
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
                setSendInit({ recipient: 'GBXKZ5LITZS5COXM5275MQCTRKEK5M2UVR3GARY35OKH32WUMVL67X7M', amount: 5, memoText: `Spende ${t('main.title')}` });
                setMenuSelection('sendPayment');
              } else {
                setSendInit(null);
                setMenuSelection(next);
              }
            }}
          />
        )}

        {error && <p className="text-red-500 mt-4">{t(error)}</p>}
      </div>

      {/* Menüansicht anzeigen (z.B. ListAll) */}
      {menuSelection === 'listAll' && (
        sourcePublicKey ? (
          <>
            <p className="text-sm text-gray-400">{error}</p>
            <ListTrustlines
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
          </>
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('trustline.all')}</h2></div>
            {t('investedTokens.hintEnterPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'compare' && (
        sourcePublicKey ? (
          <CompareTrustlines
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
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('trustline.compare')}</h2></div>
            {t('investedTokens.hintEnterPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'deleteAll' && (
        <DeleteAllTrustlines
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
            publicKey={sourcePublicKey}
            onBack={() => setMenuSelection(null)}  // oder null, wie du magst
          />
        ) : (
          <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
            <div className="text-center mb-2"><h2 className="text-xl font-semibold">{t('xlmByMemo.page.title')}</h2></div>
            {t('xlmByMemo.page.noPublicKey')}
          </div>
        )
      )}
      {menuSelection === 'payments' && (
        <InvestedTokensPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}
      {menuSelection === 'balance' && (
        <BalancePage
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
      {menuSelection === 'settings' && (
        <SettingsPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}
      {menuSelection === 'multisigCreate' && (
      <MultisigCreatePage />
      )}
           {menuSelection === 'multisigEdit' && (
        <MultisigEditPage defaultPublicKey={sourcePublicKey} />
      )}
      
      {menuSelection &&
      !['listAll','compare','deleteAll','deleteByIssuer','xlmByMemo','payments','settings','multisigCreate','multisigEdit','balance','sendPayment'].includes(menuSelection) && (
        <div className="p-3 text-sm text-red-600">
          {t('menu.unknown', { value: String(menuSelection) })}
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

      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-16 right-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 z-20"
        >
          {t('navigation.backToTop')}
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
      {infoMessage && (
        <p className="text-sm text-yellow-600 mt-2">
          {infoMessage}
        </p>
      )}

      {showSecretInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded p-4 max-w-2xl w-full mx-3 text-left">
            <h4 className="text-lg font-semibold mb-2">{t('multisigCreate.info.more')}</h4>
            <p className="text-sm whitespace-pre-line mb-3">{t('multisigCreate.info.text')}</p>
            <div className="mb-3">
              <img
                src="/stellar_signatur_flow.svg"
                alt="Signatur-Fluss"
                className="w-full h-auto border rounded"
                onError={(e)=>{e.currentTarget.style.display='none';}}
              />
            </div>
            <div className="text-right">
              <button onClick={()=>setShowSecretInfo(false)} className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700">OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Main;
