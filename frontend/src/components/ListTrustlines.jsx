// src/components/ListTrustlines.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { validateSecretKey } from '../services/stellarUtils';
import SecretKeyModal from './SecretKeyModal';
import { deleteTrustlines } from '../services/stellarUtils';
import { assertKeyPairMatch } from '../services/stellarUtils';
import MenuHeader from './MenuHeader';

function ListTrustlines({
  trustlines,
  itemsPerPage,
  currentPage,
  onPageChange,
  sortColumn,
  sortDirection,
  onSort,
  filters,
  onFilterChange,
  selectedTrustlines,
  onToggleTrustline,
  onToggleAll,
  setSelectedTrustlines,
  setResults,
  setError,
  setMenuSelection,
  menuSelection,
  setSecretKey,
  publicKey
}) {
  const { t } = useTranslation();
  const [paginated, setPaginated] = useState([]);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [overviewSort, setOverviewSort] = useState({ column: 'assetCode', direction: 'asc' });
  // Steuert die Anzeige eines Ladeindikators beim Löschvorgang
  const [isProcessing, setIsProcessing] = useState(false);
  // Fehlerausgabe im Secret-Key-Modal
  const [modalError, setModalError] = useState('');
  // Ergebnisse für Info- oder Fehlermeldungen nach Löschaktionen
  const [localResults, setLocalResults] = useState([]);
  const hasMultiplePages = trustlines.length > itemsPerPage;


  // Simulationsmodus aktiv?
  const [simulationMode, setSimulationMode] = useState(true);

  useEffect(() => {
    let filtered = trustlines.filter((tl) => {
      return (
        (!filters.assetCode || tl.assetCode.toLowerCase().includes(filters.assetCode.toLowerCase())) &&
        (!filters.assetIssuer || tl.assetIssuer.toLowerCase().includes(filters.assetIssuer.toLowerCase())) &&
        (!filters.createdAt || tl.createdAt?.toLowerCase().includes(filters.createdAt.toLowerCase()))
      );
    });

    filtered.sort((a, b) => {
      const isAsc = sortDirection === 'asc' ? 1 : -1;
      const isSelected = (item) => selectedTrustlines.some(sel => sel.assetCode === item.assetCode && sel.assetIssuer === item.assetIssuer);
      if (sortColumn === 'selected') {
        return (isSelected(a) === isSelected(b)) ? 0 : isSelected(a) ? -1 * isAsc : 1 * isAsc;
      } else if (sortColumn === 'assetCode') {
        return a.assetCode.localeCompare(b.assetCode) * isAsc;
      } else if (sortColumn === 'assetIssuer') {
        return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
      } else if (sortColumn === 'createdAt') {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return (dateA - dateB) * isAsc;
      }
      return 0;
    });

    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    setPaginated(filtered.slice(start, end));
  }, [trustlines, filters, sortColumn, sortDirection, currentPage, itemsPerPage, selectedTrustlines]);

  const isSelected = (item) => selectedTrustlines.some(sel => sel.assetCode === item.assetCode && sel.assetIssuer === item.assetIssuer);
  const allSelected = paginated.length > 0 && paginated.every(isSelected);

    /**
   * Simuliert das Löschen der ausgewählten Trustlines nach erfolgreicher Secret-Key-Validierung.
   * Zeigt ein übersetztes Ergebnis im Ergebnisbereich an.
   * @param {string} secretKey - Der zu validierende Secret Key (SB...)
   */
  const handleDeleteSimulated = (secretKey) => {
    try {
      validateSecretKey(secretKey);
      // Gehört der Secret Key zum aktuell geladenen Wallet?
      assertKeyPairMatch(secretKey, publicKey);const count = selectedTrustlines.length;
      setLocalResults([t('trustlines.deleted.simulated', { count })]);
      setSelectedTrustlines([]);
      setSecretKey('');
      setModalError('');
      setShowSecretModal(false);
    } catch (err) {
      setModalError(t(err.message));
    }
  };

    /**
   * Führt eine echte Trustline-Löschung durch, nach Validierung des Secret Keys.
   * Zeigt Erfolg oder Fehler im UI an.
   * @param {string} secretKey - Secret Key des Absenders
   */
  const handleDeleteTrustlines = async (secretKey) => {
    let deleted = [];

    try {
      // Formatprüfung des Secret Keys
      validateSecretKey(secretKey);

      // Gehört der Secret Key zum aktuell geladenen Wallet?
      assertKeyPairMatch(secretKey, publicKey);

      // UI vorbereiten
      setIsProcessing(true);
      setModalError('');
      setLocalResults([t('trustline.deleted.success', { count: deleted.length }),]);
      console.log('[UI] localResults gesetzt:', deleted.length);

      // Trustlines wirklich löschen via Horizon
      const deleted = await deleteTrustlines({
        secretKey,
        trustlines: selectedTrustlines,
      });

      console.log('[DEBUG] Löschung erfolgreich:', deleted);

      // Erfolgsmeldung anzeigen
      setLocalResults([
        t('trustline.deleted.success', { count: deleted.length }),
      ]);

      // Auswahl und Modal zurücksetzen
      setSelectedTrustlines([]);
      setShowSecretModal(false);
      setSecretKey('');
    } catch (err) {
      console.error('[ERROR] Löschung fehlgeschlagen:', err);
      setLocalResults([
        t('transaction.failed') + ': ' + (err.message || 'unknown'),
      ]);
    } finally {
      setIsProcessing(false);
    }
  };


  const handleSortOverview = (column) => {
    const direction = overviewSort.column === column ? (overviewSort.direction === 'asc' ? 'desc' : 'asc') : 'asc';
    setOverviewSort({ column, direction });
  };

  const sortedOverview = [...selectedTrustlines].sort((a, b) => {
    const isAsc = overviewSort.direction === 'asc' ? 1 : -1;
    if (overviewSort.column === 'assetCode') {
      return a.assetCode.localeCompare(b.assetCode) * isAsc;
    } else if (overviewSort.column === 'assetIssuer') {
      return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
    }
    return 0;
  });

  const handleToggleFromOverview = (tl) => {
    const stillSelected = selectedTrustlines.filter(item => !(item.assetCode === tl.assetCode && item.assetIssuer === item.assetIssuer));
    setSelectedTrustlines(stillSelected);
  };

  return (
    <div className="mt-4">
      {/* Menükopf mit Zurück-Button + aktuelle Ansicht */}
      <MenuHeader setMenuSelection={setMenuSelection} menuSelection={menuSelection} />

      {/* Infoleiste: Wallet, Anzahl, Modusauswahl */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-gray-500 rounded p-3 text-sm mb-4">
        <div className="text-gray-700 dark:text-gray-300 mb-2 sm:mb-0">
          {t('trustline.list')}: {trustlines.length}
        </div>

        <div className="flex gap-4 items-center">
          {/* 🔘 Radiobuttons */}
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" value="simulation" checked={simulationMode} onChange={() => setSimulationMode(true)} />
            {t('trustline.mode.simulation')}
          </label>
          <label className="flex items-center gap-1 text-red-700">
            <input type="radio" name="mode" value="real" checked={!simulationMode} onChange={() => setSimulationMode(false)} />
            {t('trustline.mode.real')}
            <span title={t('trustline.mode.realWarning')} className="text-xl">⚠️🚨</span>
          </label>

          {/* 🗑️ Löschen-Button */}
          {selectedTrustlines.length > 0 && (
            <div className="absolute left-1/3 transform -translate-x-1/2">
              <button
                onClick={() => setShowOverviewModal(true)}
                className="ml-4 px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('trustline.delete')}
              </button>
            </div>
          )}
        </div>
      </div>

      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th className="px-4 py-2 cursor-pointer" onClick={() => onSort('selected')}>
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
            </th>
            <th className="px-4 py-2 cursor-pointer" onClick={() => onSort('assetCode')}>{t('asset.code')}</th>
            <th className="px-4 py-2 cursor-pointer" onClick={() => onSort('assetIssuer')}>{t('asset.issuer')}</th>
            <th className="px-4 py-2 cursor-pointer" onClick={() => onSort('createdAt')}>{t('asset.creationDate')}</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((tl, index) => (
            <tr key={index} className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={isSelected(tl)}
                  onChange={() => onToggleTrustline(tl)}
                />
              </td>
              <td className="px-4 py-2">{tl.assetCode}</td>
              <td className="px-4 py-2">{tl.assetIssuer}</td>
              <td className="px-4 py-2">{tl.createdAt ? new Date(tl.createdAt).toLocaleString() : t('asset.creationDate.unknown')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {localResults.length > 0 && (
        <div className="mt-4 text-sm text-blue-600 dark:text-blue-400">
          {localResults.map((msg, idx) => <p key={idx}>{msg}</p>)}
        </div>
      )}

      {selectedTrustlines.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowOverviewModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('trustline.delete.button')}
          </button>
        </div>
      )}
      {hasMultiplePages && selectedTrustlines.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => setShowOverviewModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('trustline.delete.button')}
          </button>
        </div>
      )}

      {showOverviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-3xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4 text-black dark:text-white">{t('option.confirm.action.title')}</h2>
            <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">{t('option.confirm.action.text')}</p>

            <table className="min-w-full text-sm mb-4">
              <thead>
                <tr>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetCode')}>{t('asset.code')}</th>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetIssuer')}>{t('asset.issuer')}</th>
                  <th className="px-2 py-1">{t('option.delete')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedOverview.map((tl, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1">{tl.assetCode}</td>
                    <td className="px-2 py-1">{tl.assetIssuer}</td>
                    <td className="px-2 py-1">
                      <button
                        className="text-red-600 hover:underline"
                        onClick={() => handleToggleFromOverview(tl)}
                      >
                        {t('option.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowOverviewModal(false)}
                className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
              >
                {t('option.cancel')}
              </button>
              <button
                onClick={() => {
                  setShowOverviewModal(false);
                  setShowSecretModal(true);
                }}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('option.yes')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(key) => {
            setShowSecretModal(false);
            if (simulationMode) {
              handleDeleteSimulated(key);
            } else {
              handleDeleteTrustlines(key);
            }
          }}
          onCancel={() => setShowSecretModal(false)}
          errorMessage={modalError}
        />
      )}
      {isProcessing && (
        <p className="text-blue-600 text-sm mt-2">{t('main.processing')}</p>
      )}   
   </div>
  );
}

export default ListTrustlines;
