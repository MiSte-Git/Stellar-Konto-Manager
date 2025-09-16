import trustlineLogo from './assets/Trustline-Logo.jpg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BACKEND_URL } from './config';
import { 
  loadTrustlines, 
  resolveOrValidatePublicKey, 
  handleSourceSubmit as submitSourceInput,
  handleDeleteTrustlines as deleteAndReload
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
  areAllSelected,
  isSelected,
  toggleTrustlineSelection
} from './utils/stellar/trustlineUtils';
import { 
  handleSort,
  handleFilterChange 
} from './utils/uiHelpers.js';
import XlmByMemoPanel from './components/XlmByMemoPanel';
import XlmByMemoPage from './pages/XlmByMemoPage';
import InvestedTokensPage from './pages/InvestedTokensPage';
import SettingsPage from './pages/SettingsPage.jsx';

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
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

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
      } catch {}
      return next;
    });
  };
  const handleDeleteTrustlines = async (secretKey) => {
    setIsLoading(true);
    setError('');
    try {
      const { deleted, updatedTrustlines } = await deleteAndReload({
        secretKey,
        trustlinesToDelete: selectedTrustlines,
        sourcePublicKey,
        t,
        horizonServer: null, // optional – falls du `horizonServer` explizit übergibst
      });

      setTrustlines(updatedTrustlines);
      setResults([{ type: 'success', message: t('trustlines.deleted.success', { count: deleted.length }) }]);
      setSelectedTrustlines([]);
      setShowSecretKey(false);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
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
    } catch {}
  }, []);

  function persistRecent(list) {
    try { localStorage.setItem('recentWallets', JSON.stringify(list)); } catch {}
  }
  function addRecent(pk) {
    if (!pk) return;
    setRecentWallets(prev => {
      const next = [pk, ...prev.filter(x => x !== pk)].slice(0, 20);
      persistRecent(next);
      return next;
    });
  }

  async function handleHeaderApply() {
    const input = (walletHeaderInput || '').trim();
    if (!input) return;
    setIsLoading(true);
    setError('');
    try {
      const { publicKey, trustlines } = await submitSourceInput(input, t);
      setSourcePublicKey(publicKey);
      if (Array.isArray(trustlines)) setTrustlines(trustlines);
      addRecent(publicKey);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleRecentDelete() {
    const key = (walletHeaderInput || '').trim();
    if (!key) return;
    setRecentWallets(prev => {
      const next = prev.filter(x => x !== key);
      persistRecent(next);
      return next;
    });
  }

  // Aktuelle Wallet automatisch in "Zuletzt verwendet" aufnehmen
  useEffect(() => {
    if (sourcePublicKey) addRecent(sourcePublicKey);
  }, [sourcePublicKey]);

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
    } catch {}
    setSelectedTrustlines(next);
  };

  return (
     <>
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-0 text-center mt-4-500">
        {/* 🌍 Global: Titel & Info */}
        <h1 className="text-2xl font-bold mb-4">{t('main.title')}</h1>
        <p className="mb-4 text-sm text-blue-200 rounded border">{t('secretKey.info')}</p>
        {/* Fixierter Wallet-Header – immer sichtbar */}
        <div className="sticky top-0 z-30 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b rounded-b px-3 py-2 mb-3">
          <form onSubmit={(e) => { e.preventDefault(); handleHeaderApply(); }} className="max-w-4xl mx-auto mb-0">
            <label className="block font-bold mb-1 text-sm">{t('publicKey.label')}</label>
            <div className="relative">
              <input
                type="text"
                list="recent-wallets"
                value={walletHeaderInput}
                onChange={(e) => setWalletHeaderInput(e.target.value)}
                placeholder={t('publicKey.placeholder')}
                className="wallet-input w-full border border-gray-300 rounded p-2 pr-8 font-mono text-sm"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                inputMode="text"
              />
              {walletHeaderInput && (
                <button
                  type="button"
                  onClick={() => setWalletHeaderInput('')}
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
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={isLoading || !walletHeaderInput.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                title="Wallet übernehmen"
              >
                Übernehmen
              </button>
              <button
                type="button"
                onClick={handleRecentDelete}
                disabled={isLoading || !recentWallets.includes((walletHeaderInput || '').trim())}
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Aus Liste löschen
              </button>
            </div>
          </form>
        </div>

        {sourcePublicKey && (
          <p className="mb-4 pb-1 text-sm text-gray-700 dark:text-gray-200 font-mono">
            {t('publicKey.source')}: {sourcePublicKey}
          </p>
        )}

        {/* Menüauswahl sichtbar, unabhängig davon ob ein Wallet gesetzt ist */}
        {!menuSelection && (
          <MainMenu
            onSelect={(value) => {
              const next = (value ?? '').trim();
              console.log('[MainMenu onSelect]', JSON.stringify(next));
              setMenuSelection(next);
            }}
          />
        )}

        {error && <p className="text-red-500 mt-4">{t(error)}</p>}
      </div>

      {/* Menüansicht anzeigen (z.B. ListAll) */}
      {menuSelection === 'listAll' && (
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
      )}
      {menuSelection === 'compare' && (
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
        <XlmByMemoPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}  // oder null, wie du magst
        />
      )}
      {menuSelection === 'payments' && (
        <InvestedTokensPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}
      {menuSelection === 'settings' && (
        <SettingsPage
          publicKey={sourcePublicKey}
          onBack={() => setMenuSelection(null)}
        />
      )}

      {menuSelection &&
      !['listAll','compare','deleteAll','deleteByIssuer','xlmByMemo','payments','settings'].includes(menuSelection) && (
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
    </>
  );
}

export default Main;
