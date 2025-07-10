import trustlineLogo from './assets/Trustline-Logo.jpg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BACKEND_URL } from './config';
import { 
  resolveFederationAddress, 
  loadTrustlines, 
  resolveOrValidatePublicKey, 
  findDuplicateTrustlines,
  sortTrustlines,
  paginateTrustlines,
  validateSecretKey
 } from './services/stellarUtils.js';
import App from './App.jsx';
import SourceInput from './components/SourceInput';
import DestinationInput from './components/DestinationInput';
import MainMenu from './components/MainMenu';
import ListTrustlines from './components/ListTrustlines';
import ResultDisplay from './components/ResultDisplay';
import CompareTrustlines from './components/CompareTrustlines';
import LanguageSelector from './components/LanguageSelector';
import DeleteAllTrustlines from './components/DeleteAllTrustlines';
import DeleteByIssuer from './components/DeleteByIssuer';
import ConfirmationModal from './components/ConfirmationModal';
import './index.css'; // Enthält @tailwind + dein echtes Styling

console.log('main.jsx loaded');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

console.log('main.jsx Nach ReactDOM');

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
    console.debug('[DEBUG] useEffect check: menuSelection is', menuSelection);
  }, [menuSelection]);

  // Handle source address input (federation or public key)
  const handleSourceSubmit = async () => {
    setError('');
    setIsLoading(true);
    let publicKey;
    try {
      console.log("sourceInput submitted:", sourceInput);
      publicKey = sourceInput;
      publicKey = await resolveOrValidatePublicKey(sourceInput);
    } catch (resolveError) {
      setError(t(resolveError.message));
      setIsLoading(false);
      return;
    }
    try {
      setSourcePublicKey(publicKey);
      setTrustlines(await loadTrustlines(publicKey));
      setMenuSelection(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompareTrustlines = async () => {
    try {
      const duplicates = await findDuplicateTrustlines(sourcePublicKey, destinationPublicKey);

      if (duplicates.length > 0) {
        setResults(duplicates);
        setConfirmAction(() => async () => {
          try {
            validateSecretKey(sourceSecret);
          } catch (err) {
            setError(t(err.message));
            return;
          }

          try {
            const response = await fetch(`${BACKEND_URL}/delete-trustlines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secretKey: sourceSecret, trustlines: duplicates })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'submitTransaction.failed:Unknown error.');
            setResults([...result.messages, t('secretKey.cleared')]);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            const detail = err.message || 'submitTransaction.failed:Unknown error.';
            throw new Error('submitTransaction.failed:' + detail);
          }
        });
        setShowConfirm(true);
      } else {
        setResults([t('trustline.noDuplicates')]);
      }
    } catch (err) {
      setError(t(err.message));
    } finally {
      setIsLoading(false);
    }
  };
  // Neue Sortierfunktion
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filter-Update
  const handleFilterChange = (key, value) => {
    setFilters({ ...filters, [key]: value });
    setCurrentPage(0); // Bei Filterwechsel auf Seite 1 zurück
  };

  // Checkbox-Auswahl pro Trustline
  const handleToggleTrustline = (tl) => {
    const exists = selectedTrustlines.includes(tl);
    if (exists) {
      setSelectedTrustlines(selectedTrustlines.filter(item => item !== tl));
    } else {
      setSelectedTrustlines([...selectedTrustlines, tl]);
    }
  };

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
              <MainMenu onSelect={setMenuSelection} />
            )}
          </div>
        )}

        {error && <p className="text-red-500 mt-4">{error}</p>}
      </div>

      {/* Menüansicht anzeigen (z. B. ListAll) */}
      {menuSelection === 'listAll' && (
        <>
        <p className="text-sm text-gray-400">{error}</p>
          <ListTrustlines
            trustlines={trustlines}
            itemsPerPage={ITEMS_PER_PAGE}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
            filters={filters}
            onFilterChange={handleFilterChange}
            selectedTrustlines={selectedTrustlines}
            setSelectedTrustlines={setSelectedTrustlines} 
            onToggleTrustline={handleToggleTrustline}
            onToggleAll={handleToggleAll}
            results={results}
            setResults={setResults}
            setError={setError}
            setMenuSelection={setMenuSelection}
            menuSelection={menuSelection}
            setSecretKey={setSourceSecret}
            publicKey={sourcePublicKey}
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
      {results.length > 0 && (
        <ResultDisplay
          results={results}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
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
    </>
  );
}

export default Main;
