import viteLogo from '/vite.svg';
import './i18n'; // Initialisiert die Sprachunterstützung
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import reactLogo from './assets/react.svg';
import ReactDOM from 'react-dom/client';
import { Horizon } from '@stellar/stellar-sdk';
import App from './App.jsx';
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
  const [count, setCount] = useState(0);
  const server = new Horizon.Server('https://horizon.stellar.org');
  const BACKEND_URL = 'http://localhost:3000'; // Update for production
  const ITEMS_PER_PAGE = 333;

  // Resolve federation address to public key
  async function resolveFederationAddress(federationAddress) {
    try {
      const federationServer = new StellarSdk.FederationServer('https://federation.stellar.org');
      const response = await federationServer.resolve(federationAddress);
      if (!response.account_id) throw new Error('No account_id in federation response');
      return response.account_id;
    } catch (error) {
      throw new Error(`Failed to resolve federation address: ${error.message}`);
    }
  }

  // Load account trustlines
  async function loadTrustlines(publicKey) {
    try {
      const account = await server.loadAccount(publicKey);
      if (!account.balances) throw new Error('No balances found for account');
      const trustlines = account.balances
        .filter(balance => balance.asset_type !== 'native' && balance.asset_code && balance.asset_issuer)
        .map(balance => ({
          assetCode: balance.asset_code,
          assetIssuer: balance.asset_issuer,
          creationDate: null // Placeholder for creation date
        }));

      // Fetch creation dates from operations endpoint
      const operations = server.operations().forAccount(publicKey).order('desc').limit(200);
      let cursor = null;
      const trustlineMap = new Map(trustlines.map(t => [`${t.assetCode}:${t.assetIssuer}`, t]));

      while (trustlineMap.size > 0) {
        try {
          const opResponse = cursor
            ? await operations.cursor(cursor).call()
            : await operations.call();
          if (!opResponse.records || opResponse.records.length === 0) break;

          for (const op of opResponse.records) {
            if (op.type === 'change_trust' && op.asset_code && op.asset_issuer) {
              const key = `${op.apublic_keysset_code}:${op.asset_issuer}`;
              if (trustlineMap.has(key)) {
                trustlineMap.get(key).creationDate = new Date(op.created_at);
                trustlineMap.delete(key);
              }
            }
          }
          cursor = opResponse.next ? (await opResponse.next()).cursor : null;
          if (!cursor) break;
        } catch (opError) {
          console.error('Error fetching operations:', opError);
          break; // Stop pagination on error to prevent infinite loop
        }
      }

      return trustlines;
    } catch (error) {
      throw new Error(`Failed to load account ${publicKey}: ${error.message}`);
    }
  }

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
      let publicKey = sourceInput;
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

  // Get paginated trustlines
  const getPaginatedTrustlines = (trustlines) => {
    const startIndex = currentPage * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return trustlines.slice(startIndex, endIndex);
  };

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

  // Handle delete all trustlines
  const handleDeleteAllTrustlines = async () => {
    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      if (trustlines.length > 0) {
        setResults(trustlines);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StellarSdk.StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError('Invalid source secret key.');
            return;
          }
          try {
            console.log('Sending fetch to:', BACKEND_URL + '/delete-trustlines');
            console.log('Request body:', { secretKey: sourceSecret, trustlines });
            const response = await fetch(`${BACKEND_URL}/delete-trustlines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secretKey: sourceSecret, trustlines })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to delete trustlines.');
            setResults([...result.messages, 'Secret key has been cleared.']);
            setTrustlines([]);
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
        setResults(['No trustlines found.']);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle delete trustlines by issuer
  const handleDeleteByIssuer = async () => {
    if (!issuerAddress || !StellarSdk.StrKey.isValidEd25519PublicKey(issuerAddress)) {
      setError('Invalid issuer address.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      const issuerTrustlines = trustlines.filter(t => t.assetIssuer === issuerAddress);
      if (issuerTrustlines.length > 0) {
        setResults(issuerTrustlines);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StellarSdk.StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError('Invalid source secret key.');
            return;
          }
          try {
            console.log('Sending fetch to:', BACKEND_URL + '/delete-trustlines');
            console.log('Request body:', { secretKey: sourceSecret, trustlines: issuerTrustlines });
            const response = await fetch(`${BACKEND_URL}/delete-trustlines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secretKey: sourceSecret, trustlines: issuerTrustlines })
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
        setResults([`No trustlines found for issuer ${issuerAddress}.`]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Render confirmation modal
  const ConfirmationModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4">Confirm Action</h2>
        <p className="mb-4">Are you sure you want to delete the listed trustlines? Your secret key will be sent to a secure backend and not stored.</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={async () => {
              setIsLoading(true);
              try {
                await confirmAction();
                setShowConfirm(false);
              } catch (err) {
                setError(err.message);
              } finally {
                setIsLoading(false);
              }
            }}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            disabled={isLoading}
          >
            Yes
          </button>
          <button
            onClick={() => {
              setShowConfirm(false);
              setResults(['Secret key has been cleared.']);
              setSourceSecret('');
              setShowSecretKey(false);
            }}
            className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

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
        <div className="mb-4">
          <label className="block mb-2">Enter Source Federation Address or Public Key:</label>
          <input
            type="text"
            value={sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="e.g., user*example.com or GD4TPVR..."
          />
          <button
            onClick={handleSourceSubmit}
            className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Submit'}
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-4">Source Wallet: {sourcePublicKey}</p>
          {!menuOption ? (
            <div className="space-y-2">
              <button
                onClick={() => handleMenuOption('listAll')}
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
              >
                List All Trustlines
              </button>
              <button
                onClick={() => handleMenuOption('compare')}
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
              >
                Compare Trustlines
              </button>
              <button
                onClick={() => handleMenuOption('deleteAll')}
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
              >
                Delete All Trustlines
              </button>
              <button
                onClick={() => handleMenuOption('deleteByIssuer')}
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
              >
                Delete Trustlines by Issuer
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setMenuOption(null)}
                className="mb-4 bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
              >
                Back to Menu
              </button>
              {menuOption === 'listAll' && (
                <div>
                  <button
                    onClick={handleListAllTrustlines}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'List Trustlines'}
                  </button>
                </div>
              )}
              {menuOption === 'compare' && (
                <div>
                  <label className="block mb-2">Enter Destination Public Key:</label>
                  <input
                    type="text"
                    value={destinationPublicKey}
                    onChange={(e) => setDestinationPublicKey(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="e.g., GBZVTOY..."
                  />
                  <button
                    onClick={handleCompareTrustlines}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'Compare Trustlines'}
                  </button>
                </div>
              )}
              {menuOption === 'deleteAll' && (
                <div>
                  <button
                    onClick={handleDeleteAllTrustlines}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'List Trustlines'}
                  </button>
                </div>
              )}
              {menuOption === 'deleteByIssuer' && (
                <div>
                  <label className="block mb-2">Enter Issuer Address:</label>
                  <input
                    type="text"
                    value={issuerAddress}
                    onChange={(e) => setIssuerAddress(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="e.g., GA5ZSEJ..."
                  />
                  <button
                    onClick={handleDeleteByIssuer}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'List Trustlines'}
                  </button>
                </div>
              )}
              {menuOption !== 'listAll' && (
                <div className="mt-4">
                  <label className="block mb-2">Enter Source Secret Key (sent securely to backend, not stored):</label>
                  <div className="flex space-x-2">
                    <input
                      type={showSecretKey ? 'text' : 'password'}
                      value={sourceSecret}
                      onChange={(e) => setSourceSecret(e.target.value)}
                      className="w-full p-2 border rounded"
                      placeholder="e.g., SB..."
                    />
                    <button
                      onClick={() => setShowSecretKey(!showSecretKey)}
                      className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
                    >
                      {showSecretKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {results.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xl font-bold">Results:</h2>
          {typeof results[0] === 'string' ? (
            <ul className="list-disc pl-5">
              {results.map((result, index) => (
                <li key={index}>{result}</li>
              ))}
            </ul>
          ) : (
            <div>
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th
                      className={`border border-gray-300 p-2 cursor-pointer hover:bg-gray-200 ${sortColumn === 'assetCode' ? 'font-bold bg-gray-200' : ''}`}
                      onClick={() => handleSort('assetCode')}
                    >
                      Asset Code {sortColumn === 'assetCode' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className={`border border-gray-300 p-2 cursor-pointer hover:bg-gray-200 ${sortColumn === 'assetIssuer' ? 'font-bold bg-gray-200' : ''}`}
                      onClick={() => handleSort('assetIssuer')}
                    >
                      Issuer {sortColumn === 'assetIssuer' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className={`border border-gray-300 p-2 cursor-pointer hover:bg-gray-200 ${sortColumn === 'creationDate' ? 'font-bold bg-gray-200' : ''}`}
                      onClick={() => handleSort('creationDate')}
                    >
                      Creation Date {sortColumn === 'creationDate' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {getPaginatedTrustlines(getSortedAndFilteredTrustlines(results)).map((result, index) => (
                    <tr key={index}>
                      <td className="border border-gray-300 p-2">{result.assetCode}</td>
                      <td className="border border-gray-300 p-2">{result.assetIssuer}</td>
                      <td className="border border-gray-300 p-2">
                        {result.creationDate
                          ? result.creationDate.toLocaleString()
                          : 'Unknown (created before available history)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex items-center justify-between z-10">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 0))}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
                  disabled={currentPage === 0}
                >
                  Previous
                </button>
                <span>Page {currentPage + 1} of {Math.ceil(results.length / ITEMS_PER_PAGE)}</span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(results.length / ITEMS_PER_PAGE) - 1))}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
                  disabled={currentPage >= Math.ceil(results.length / ITEMS_PER_PAGE) - 1}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-16 right-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 z-20"
        >
          Back to Top
        </button>
      )}
      {showConfirm && <ConfirmationModal />}
    </div>
  );
}

export default Main;
