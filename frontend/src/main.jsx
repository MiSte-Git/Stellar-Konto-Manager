import viteLogo from '/vite.svg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import reactLogo from './assets/react.svg';
import ReactDOM from 'react-dom/client';
import { resolveFederationAddress, loadTrustlines } from './services/stellar';
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
import { resolveFederationAddress, loadTrustlines } from './services/stellar';
import './App.css';

console.log('main.jsx loaded');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

console.log('main.jsx Nach ReactDOM');

function Main() {
	console.log('main.jsx In function Main');
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const server = new Horizon.Server('https://horizon.stellar.org');
  const BACKEND_URL = 'http://localhost:3000'; // Update for production
  const ITEMS_PER_PAGE = 333;
  const [destination, setDestination] = useState('');
  const [menuSelection, setMenuSelection] = useState(null);
  
  const [sourceInput, setSourceInput] = useState('');
  const [sourcePublicKey, setSourcePublicKey] = useState('');
  const [sourceSecret, setSourceSecret] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [destinationPublicKey, setDestinationPublicKey] = useState('');
  const [issuerAddress, setIssuerAddress] = useState('');
  const [menuOption, setMenuOption] = useState(null);
  const [trustlines, setTrustlines] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [sortColumn, setSortColumn] = useState('assetCode');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(0);
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

  // Handle source address input (federation or public key)
  const handleSourceSubmit = async () => {
    setError('');
    setIsLoading(true);
    try {
      console.log("sourceInput submitted:", sourceInput);
      let publicKey = sourceInput;
      if (!sourceInput) {
        setError("Source input is empty.");
        setIsLoading(false);
        return;
      }

      if (sourceInput.includes('*')) {
        publicKey = await resolveFederationAddress(sourceInput);
      } else if (!StellarSdk.StrKey.isValidEd25519PublicKey(sourceInput)) {
        throw new Error('Invalid public key or federation address.');
      }
      setSourcePublicKey(publicKey);
      setTrustlines(await loadTrustlines(publicKey));
      setMenuOption(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  //TODO: Ist vieleicht für das Menü der Trustline Optionen nötig
  // Handle menu option selection
  const handleMenuOption = (option) => {
    setMenuOption(option);
    setError('');
    setResults([]);
    setDestinationPublicKey('');
    setIssuerAddress('');
    setSourceSecret('');
    setShowSecretKey(false);
    setSortColumn('assetCode');
    setSortDirection('asc');
    setCurrentPage(0);
  };

  // TODO: implement sorting/filtering in ResultDisplay
  // Sort trustlines
  const getSortedAndFilteredTrustlines = (trustlines) => {
    return [...trustlines].sort((a, b) => {
      const isAsc = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'assetCode') {
        return a.assetCode.localeCompare(b.assetCode) * isAsc;
      } else if (sortColumn === 'assetIssuer') {
        return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
      } else if (sortColumn === 'creationDate') {
        const dateA = a.creationDate ? a.creationDate.getTime() : (isAsc ? Infinity : -Infinity);
        const dateB = b.creationDate ? b.creationDate.getTime() : (isAsc ? Infinity : -Infinity);
        return (dateA - dateB) * isAsc;
      }
      return 0;
    });
  };

  // TODO: sorting/filtering in ResultDisplay
  // Handle header click for sorting
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(0); // Reset to first page on sort
  };

  // TODO: use pagination in ResultDisplay
  // Get paginated trustlines
  const getPaginatedTrustlines = (trustlines) => {
    const startIndex = currentPage * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return trustlines.slice(startIndex, endIndex);
  };

  // TODO: Prüfen ob noch irgendwo genutzt 
  // Handle list all trustlines
  const handleListAllTrustlines = async () => {
    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      if (trustlines.length > 0) {
        setResults(trustlines);
      } else {
        setResults(['No trustlines found.']);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle compare trustlines
  const handleCompareTrustlines = async () => {
    if (!destinationPublicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
      setError('Invalid destination public key.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const sourceTrustlines = await loadTrustlines(sourcePublicKey);
      const destTrustlines = await loadTrustlines(destinationPublicKey);
      const duplicates = sourceTrustlines.filter(source =>
        destTrustlines.some(dest =>
          dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
        )
      );
      if (duplicates.length > 0) {
        setResults(duplicates);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StellarSdk.StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError('Invalid source secret key.');
            return;
          }
          try {
            console.log('Sending fetch to:', BACKEND_URL + '/delete-trustlines');
            console.log('Request body:', { secretKey: sourceSecret, trustlines: duplicates });
            const response = await fetch(`${BACKEND_URL}/delete-trustlines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secretKey: sourceSecret, trustlines: duplicates })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to delete trustlines.');
            setResults([...result.messages, 'Secret key has been cleared.']);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message.includes('Failed to fetch')
              ? `Cannot connect to backend. Ensure the server is running at ${BACKEND_URL} and CORS is enabled.`
              : err.message);
          }
        });
        setShowConfirm(true);
      } else {
        setResults(['No duplicate trustlines found.']);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        	<a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <LanguageSelector /> {/* Sprachwahl Dropdown oben anzeigen */}
      <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
      <p className="mb-4 text-sm text-gray-600">Secret keys are securely handled by the backend and never stored.</p>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
      {!sourcePublicKey ? (
        <SourceInput
          sourceInput={sourceInput}
          setSourceInput={setSourceInput}
          onSubmit={handleSourceSubmit}
          isLoading={isLoading}
        />
      ) : (
        <div>
          <p className="mb-4">Source Wallet: {sourcePublicKey}</p>
          {sourcePublicKey && !menuSelection && (
            <MainMenu onSelect={setMenuSelection} />
          )}
        </div>
      )}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {menuSelection === 'listAll' && (
        <ListTrustlines
          sourcePublicKey={sourcePublicKey}
          backendUrl={BACKEND_URL}
          setResults={setResults}
          setError={setError}
        />
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
          isLoading={isLoading}
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
        <ResultDisplay results={results} />
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
    </div>
  );
}

export default Main;
