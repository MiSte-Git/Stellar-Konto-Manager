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
import SourceInput from './components/SourceInput';
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
  const [filters, setFilters] = useState({ assetCode: '', assetIssuer: '', createdAt: '' });
  const [sortColumn, setSortColumn] = useState('assetCode');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(0);
  const ITEMS_PER_PAGE = 333;const [menuSelection, setMenuSelection] = useState(null);
  const [sourceInput, setSourceInput] = useState('');
  const [sourcePublicKey, setSourcePublicKey] = useState('');
  const [sourceSecret, setSourceSecret] = useState('');
  const [destinationPublicKey, setDestinationPublicKey] = useState('');
  const [issuerAddress, setIssuerAddress] = useState('');
  // Trustlines und Secret Keys werden nur für Backend-Operationen aktualisiert, aber nicht gerendert
  // Deshalb setzen wir nur setTrustlines, lesen aber trustlines nicht aus → ignorierbare Warnung
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const handleSourceSubmit = async () => {
    setError('');
    setIsLoading(true);
    try {
      const { publicKey, trustlines } = await submitSourceInput(sourceInput, t);
      setSourcePublicKey(publicKey);
      console.log('[DEBUG] Geladene Trustlines:', trustlines);
      setTrustlines(trustlines);
      setMenuSelection(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  const handleSortClick = (column) => {
    handleSort(column, sortColumn, sortDirection, setSortColumn, setSortDirection);
  };
  const handleFilterUpdate = (key, value) => {
    handleFilterChange(key, value, filters, setFilters, setCurrentPage);
  };
  const handleToggleTrustline = (tl) => {
    if (tl.assetBalance !== "0.0000000") return;
    const newSelection = toggleTrustlineSelection(tl, selectedTrustlines);
    setSelectedTrustlines(newSelection);
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
    const allSelected = paginatedList.every(tl => selectedTrustlines.includes(tl));
    if (allSelected) {
      setSelectedTrustlines(selectedTrustlines.filter(tl => !paginatedList.includes(tl)));
    } else {
      const newSelection = [...selectedTrustlines, ...paginatedList.filter(tl => !selectedTrustlines.includes(tl))];
      setSelectedTrustlines(newSelection);
    }
  };

  return (
     <>
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-0 text-center mt-4-500">
        {/* 🌍 Global: Titel & Info */}
        <h1 className="text-2xl font-bold mb-4">{t('main.title')}</h1>
        <p className="mb-4 text-sm text-blue-200 rounded border">{t('secretKey.info')}</p>
        {sourcePublicKey && (
          <p className="mb-4 pb-1 text-sm text-gray-700 dark:text-gray-200 font-mono">
            {t('publicKey.source')}: {sourcePublicKey}
          </p>
        )}

        {/* 🔐 Eingabe oder Menüwahl */}
        {!sourcePublicKey ? (
          <SourceInput
            sourceInput={sourceInput}
            setSourceInput={setSourceInput}
            onSubmit={handleSourceSubmit}
            isLoading={isLoading}
          />
        ) : (
          <div>
            {/* ✅ Nur Menüauswahl, keine doppelte Wallet-Anzeige */}
            {sourcePublicKey && !menuSelection && (
              <MainMenu
                onSelect={(value) => {
                  const next = (value ?? '').trim();
                  console.log('[MainMenu onSelect]', JSON.stringify(next));

                  if (next === 'backToPublicKey') {
                    setMenuSelection(null);       // Menü schließen
                    setSourcePublicKey('');       // ← wichtig: Input-Screen wird wieder sichtbar
                    setSourceInput('');           // Eingabefeld leeren (optional)
                    setTrustlines([]);            // Liste zurücksetzen (optional)
                    setSelectedTrustlines([]);    // Auswahl leeren (optional)
                    setResults([]);               // Resultate leeren (optional)
                    setError('');                 // Fehler zurücksetzen (optional, UI übersetzt via t())
                    return;
                  }
                  // Standardpfad für alle anderen Menüpunkte
                  setMenuSelection(value);
                }}
              />
            )}
          </div>
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
          Back to Top
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
