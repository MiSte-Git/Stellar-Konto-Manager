// src/components/ListTrustlines.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  validateSecretKey, 
  loadTrustlines, 
  assertKeyPairMatch, 
  deleteTrustlinesInChunks 
} from '../utils/stellar/stellarUtils';
import SecretKeyModal from './SecretKeyModal';
import MenuHeader from './MenuHeader';
import ResultModal from './ResultModal'; // ⬅️ Oben importieren
import ErrorModal from './ErrorModal';
import { 
  isSelected, 
  areAllSelected,
  toggleTrustlineSelection
} from '../utils/stellar/trustlineUtils.js';
import ProgressBar from "../components/ProgressBar.jsx";
import { formatElapsedMmSs } from '../utils/datetime';
import { useSettings } from '../utils/useSettings';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';
// import { refreshSinceCursor } from '../utils/stellar/syncUtils';

function ListTrustlines({
  trustlines,
  itemsPerPage,
  currentPage,
  sortColumn,
  sortDirection,
  onSort,
  filters,
  onFilterChange,
  selectedTrustlines,
  onToggleAll,
  setSelectedTrustlines,
  results,
  setResults,
  setMenuSelection,
  menuSelection,
  setSecretKey,
  publicKey,
  setTrustlines, 
  isProcessing,
  deleteProgress,
  setIsProcessing,
  setDeleteProgress,
  setInfoMessage,
}) {
  const { t, i18n } = useTranslation();
  const { decimalsMode } = useSettings();
  const [paginated, setPaginated] = useState([]);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [overviewSort, setOverviewSort] = useState({ column: 'assetCode', direction: 'asc' });
  // Steuert die Anzeige eines Ladeindikators beim Löschvorgang
  //const [isProcessing, setIsProcessing] = useState(false);
  // Fehlerausgabe im Secret-Key-Modal
  const [modalError, setModalError] = useState('');
  // Ergebnisse für Info- oder Fehlermeldungen nach Löschaktionen
  const [showResultModal, setShowResultModal] = useState(false);
  const [deletedTrustlines, setDeletedTrustlines] = useState([]);
  const [isSimulation, setIsSimulation] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false); // Zeile 60+
  const [errorMessage, setErrorMessage] = useState('');
  const delProg = useMemo(() => {
    const p = deleteProgress?.total ? deleteProgress.current / deleteProgress.total : 0;
    return { progress: isProcessing ? p : 0, phase: isProcessing ? 'chunkDone' : 'idle', page: 0, etaMs: 0 };
  }, [deleteProgress, isProcessing]);
  const [delElapsedMs, setDelElapsedMs] = useState(0);
  const delStartedAtRef = useRef(0);

  const balanceFmt = useMemo(() => {
    const isAuto = decimalsMode === 'auto';
    const n = isAuto ? undefined : Math.max(0, Math.min(7, Number(decimalsMode)));
    return new Intl.NumberFormat(i18n.language || undefined, {
      minimumFractionDigits: isAuto ? 0 : n,
      maximumFractionDigits: isAuto ? 7 : n,
    });
  }, [i18n.language, decimalsMode]);

  // Simulationsmodus aktiv?
  const [simulationMode, setSimulationMode] = useState(true);

  useEffect(() => {
    let id = null;
    const active = isProcessing && deleteProgress?.total > 0;
    if (active) {
      if (!delStartedAtRef.current) delStartedAtRef.current = Date.now();
      id = setInterval(() => setDelElapsedMs(Date.now() - delStartedAtRef.current), 1000);
    } else {
      delStartedAtRef.current = 0;
      setDelElapsedMs(0);
    }
    return () => id && clearInterval(id);
  }, [isProcessing, deleteProgress?.total]);

  useEffect(() => {
    let filtered = trustlines.filter((tl) => {
      return (
        (!filters.assetCode || tl.assetCode.toLowerCase().includes(filters.assetCode.toLowerCase())) &&
        (!filters.assetIssuer || tl.assetIssuer.toLowerCase().includes(filters.assetIssuer.toLowerCase())) &&
        (!filters.createdAt || tl.createdAt?.toLowerCase().includes(filters.createdAt.toLowerCase()))
      );
    });

    // Optional: nur Trustlines mit Guthaben 0 anzeigen
    if (filters.zeroOnly) {
      filtered = filtered.filter(tl => parseFloat(tl.assetBalance) === 0);
    }

    filtered.sort((a, b) => {
      const isAsc = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'assetCode') {
        return a.assetCode.localeCompare(b.assetCode) * isAsc;
      } else if (sortColumn === 'assetBalance') {
        return (parseFloat(a.assetBalance) - parseFloat(b.assetBalance)) * isAsc;
      } else if (sortColumn === 'assetIssuer') {
        return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
      } else if (sortColumn === 'createdAt') {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return (dateA - dateB) * isAsc;
      }
      // Ignore 'selected' sort to avoid jumping rows
      return 0;
    });

    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    setPaginated(filtered.slice(start, end));
  }, [trustlines, filters, sortColumn, sortDirection, currentPage, itemsPerPage, selectedTrustlines]);

  useEffect(() => {
    console.log('[DEBUG] Komponente ListTrustlines wurde geladen.');
  }, []); // <-- keine Abhängigkeit

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showOverviewModal) setShowOverviewModal(false);
        if (showSecretModal) setShowSecretModal(false);
        if (showResultModal) setShowResultModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOverviewModal, showSecretModal, showResultModal]);



    /**
   * Simuliert das Löschen der ausgewählten Trustlines nach erfolgreicher Secret-Key-Validierung.
   * Zeigt ein übersetztes Ergebnis im Ergebnisbereich an.
   * @param {string} secretKey - Der zu validierende Secret Key (SB...)
   */
  const handleDeleteSimulated = (secretKey) => {
    try {
      validateSecretKey(secretKey);
      assertKeyPairMatch(secretKey, publicKey);

      // 🔍 Nur Trustlines ohne Guthaben simulieren
      const deletableTrustlines = selectedTrustlines.filter(
        (tl) => parseFloat(tl.assetBalance) === 0
      );

      const skippedCount = selectedTrustlines.length - deletableTrustlines.length;
      if (skippedCount > 0) {
        setInfoMessage(t('common:trustlines.skippedDueToBalance', { count: skippedCount }));
      }

      if (deletableTrustlines.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        return;
      }

      setResults([
        t('trustline:deleted.simulated', { count: deletableTrustlines.length })
      ]);
      setIsSimulation(true);
      setSelectedTrustlines([]);
      setDeletedTrustlines(deletableTrustlines);
      setShowResultModal(true);
      setSecretKey('');
      setModalError('');
      setShowSecretModal(false);
    } catch (err) {
      console.error('[Simulate] Fehler:', err);
      const rawMsg = String(err?.message || '');
      if (rawMsg === 'secretKey.mismatch') {
        const translated = t(rawMsg, rawMsg);
        setModalError(translated);
        alert(translated);
      } else {
        setModalError(formatErrorForUi(t, err));
      }
    }
  };

    /**
   * Führt eine echte Trustline-Löschung durch, nach Validierung des Secret Keys.
   * Zeigt Erfolg oder Fehler im UI an.
   * @param {string} secretKey - Secret Key des Absenders
   */
  const handleDeleteTrustlines = async (secretKey) => {
    try {
      delStartedAtRef.current = Date.now();
      // Formatprüfung des Secret Keys
      validateSecretKey(secretKey);

      // Gehört der Secret Key zum aktuell geladenen Wallet?
      assertKeyPairMatch(secretKey, publicKey);

      // 🔍 Nur Trustlines ohne Guthaben weiterverarbeiten
      const deletableTrustlines = selectedTrustlines.filter(
        (tl) => parseFloat(tl.assetBalance) === 0
      );

      // 💬 Hinweis anzeigen, wenn Trustlines übersprungen werden
      const skippedCount = selectedTrustlines.length - deletableTrustlines.length;
      if (skippedCount > 0) {
        setInfoMessage(t('common:trustlines.skippedDueToBalance', { count: skippedCount }));
      }

      // Wenn nichts löschbar ist, Dialog schließen
      if (deletableTrustlines.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      // UI vorbereiten
      setIsProcessing(true);
      setModalError('');

      if (deletableTrustlines.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      const onProgress = ({ processed, total /*, phase*/ }) => {
        setDeleteProgress({ current: processed, total });
      };

      // Nur Trustlines löschen, die noch im aktuellen Trustlines-Array vorkommen
      const stillValid = deletableTrustlines.filter(tl =>
        trustlines.some(current =>
          current.assetCode === tl.assetCode &&
          current.assetIssuer === tl.assetIssuer
        )
      );

      if (stillValid.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      // Fortschrittsanzeige vorbereiten
      setDeleteProgress({ current: 0, total: stillValid.length });

      // Trustlines wirklich löschen via Horizon
      const deleted = await deleteTrustlinesInChunks({
        secretKey,
        trustlines: deletableTrustlines,
        onProgress,
      });

      // Erfolgsmeldung anzeigen
      setResults([
        t('trustline:deleted.success', { count: deleted.length }),
      ]);

      // 🔄 Trustlines vollständig neu von Horizon laden
      const refreshedTrustlines = await loadTrustlines(publicKey);
      setTrustlines(refreshedTrustlines);
          
      // UI zurücksetzen
      setIsProcessing(false);      
      setIsSimulation(false);
      onFilterChange({ ...filters }); // Optional: filter neu anwenden
      setSelectedTrustlines((prev) =>
        prev.filter(tl => !deleted.some(d =>
          d.assetCode === tl.assetCode && d.assetIssuer === tl.assetIssuer
        ))
      );

      setDeletedTrustlines(deleted); // ⬅️ oder simulated
      setShowResultModal(true);
      setSecretKey('');
      setShowSecretModal(false);
    } catch (err) {
      const rawMsg = String(err?.message || '');
      const translatedOriginal = t(rawMsg, rawMsg);
      const { formatted, detail } = formatErrorForUi(t, err, { returnParts: true });

      console.error('[ERROR]', formatted);

      if (rawMsg === 'secretKey.mismatch') {
        setModalError(translatedOriginal);
        alert(translatedOriginal);
      } else {
        setModalError(formatted);
      }

      if (
        detail.includes('op_invalid_limit') ||
        detail.includes('op_has_balance') ||
        detail.includes('op_has_trustline_offer')
      ) {
        setErrorMessage(formatted); // ➜ öffnet ErrorModal
      }

      setResults([formatted]);
    } finally {
      setIsProcessing(false);
      delStartedAtRef.current = 0;
      setDelElapsedMs(0);
    }
  };


  const handleSortOverview = (column) => {
    const direction = overviewSort.column === column ? (overviewSort.direction === 'asc' ? 'desc' : 'asc') : 'asc';
    setOverviewSort({ column, direction });
  };

  // Nur Trustlines ohne Guthaben anzeigen
  const deletableOverview = selectedTrustlines.filter(
    (tl) => parseFloat(tl.assetBalance) === 0
  );

  const sortedOverview = [...deletableOverview].sort((a, b) => {
    const isAsc = overviewSort.direction === 'asc' ? 1 : -1;
    if (overviewSort.column === 'assetCode') {
      return a.assetCode.localeCompare(b.assetCode) * isAsc;
    } else if (overviewSort.column === 'assetBalance') {
      return (parseFloat(a.assetBalance) - parseFloat(b.assetBalance)) * isAsc;
    } else if (overviewSort.column === 'assetIssuer') {
      return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
    }
    return 0;
  });

  const handleToggleFromOverview = (tl) => {
    const stillSelected = selectedTrustlines.filter(item => !(item.assetCode === tl.assetCode && item.assetIssuer === tl.assetIssuer));
    setSelectedTrustlines(stillSelected);
  };

  return (
    <div className="mt-4">
      {/* Menükopf mit Zurück-Button + aktuelle Ansicht */}
      <MenuHeader setMenuSelection={setMenuSelection} menuSelection={menuSelection} />
      {/* Menütitel anzeigen */}
      <h2 className="text-center text-xl font-semibold">{t('trustline:all')}</h2>
      {/* Fortschritt der Löschung an der Spitze */}
      <div className="mb-3">
        <ProgressBar {...delProg} />
        <div className="text-xs text-gray-500 mt-1">
          {t('common:progress.elapsed', { time: formatElapsedMmSs(delElapsedMs) })}
        </div>
      </div>

      {results.length > 0 && (
        <div className="mt-4 text-sm text-blue-600 dark:text-blue-400">
          {results.map((msg, idx) => <p key={idx}>{msg}</p>)}
        </div>
      )}
 
      {/* Infoleiste: Wallet, Anzahl, Modusauswahl */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-gray-500 rounded p-3 text-sm mb-4">
        <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 mb-2 sm:mb-0 flex-wrap">
          <span>{t('trustline:all')}: {trustlines.length}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onFilterChange('zeroOnly', false)}
              className={`px-3 py-1 rounded border ${!filters.zeroOnly ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Alle anzeigen
            </button>
            <button
              type="button"
              onClick={() => { onFilterChange('zeroOnly', true); onSort('assetBalance'); }}
              className={`px-3 py-1 rounded border ${filters.zeroOnly ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Nur löschbare
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          {/* 🔘 Radiobuttons */}
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" value="simulation" checked={simulationMode} onChange={() => setSimulationMode(true)} />
            {t('trustline:deleted.mode.simulation')}
          </label>
          <label className="flex items-center gap-1 text-red-700">
            <input type="radio" name="mode" value="real" checked={!simulationMode} onChange={() => setSimulationMode(false)} />
            {t('trustline:deleted.mode.real')}
            <span title={t('trustline:deleted.mode.realWarning')} className="text-xl">⚠️🚨</span>
          </label>

          {/* 🗑️ Löschen-Button */}
          {selectedTrustlines.length > 0 && (
            <div className="ml-2">
              <button
                onClick={() => setShowOverviewModal(true)}
                className="ml-4 px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('trustline:delete')}
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
        {t('trustline:onlyZeroBalanceInfo')}
      </p>
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th className="px-4 py-2 text-left">
              <input
                type="checkbox"
                checked={areAllSelected(paginated, selectedTrustlines)}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleAll(paginated);
                  // UX: Nach "Alle" automatisch Guthaben-Sortierung und nur Guthaben=0 anzeigen
                  onSort('assetBalance');
                  onFilterChange('zeroOnly', true);
                }}
              />
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetCode')}
            >
              {t('common:asset.code', 'Asset code')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetBalance')}
            >
              {t('common:asset.balance', 'Balance')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetIssuer')}
            >
              {t('common:asset.issuer', 'Issuer')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('createdAt')}
            >
              {t('common:asset.creationDate', 'Created at')}
            </th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((tl) => (
            <tr key={`${tl.assetCode}__${tl.assetIssuer}`} className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-4 py-2 text-center align-middle">
                <input
                  type="checkbox"
                  checked={isSelected(tl, selectedTrustlines)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (parseFloat(tl.assetBalance) !== 0) {
                      alert(t('trustline:nonZeroBalance'));
                      return;
                    }
                    setSelectedTrustlines(prev => toggleTrustlineSelection(tl, prev));
                  }}
                  disabled={false}
                  className={parseFloat(tl.assetBalance) !== 0 ? 'opacity-50' : ''}
                  title={parseFloat(tl.assetBalance) !== 0 ? t('trustline:nonZeroBalance') : ''}
                />
              </td>
              <td className="px-4 py-2">{tl.assetCode}</td>
              <td className="px-4 py-2">{balanceFmt.format(Number(tl.assetBalance || 0))}</td>
              <td className="px-4 py-2">{tl.assetIssuer}</td>
              <td className="px-4 py-2">{tl.createdAt ? new Date(tl.createdAt).toLocaleString() : t('errors:asset.creationDateUnknown', 'Unknown creation date')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {selectedTrustlines.length > 0 && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowOverviewModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('trustline:delete')}
          </button>
        </div>
      )}

      {selectedTrustlines.length !== deletableOverview.length && (
        <p className="mb-2 text-sm text-yellow-600 dark:text-yellow-400">
          {t('common:trustlines.skippedDueToBalance', {
            count: selectedTrustlines.length - deletableOverview.length,
          })}
        </p>
      )}

      {showOverviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-3xl max-h-[80vh] overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              setIsScrolled(el.scrollHeight > el.clientHeight && el.scrollTop > 20);
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-black dark:text-white">
                {t('common:option.confirm.action.title', 'Confirm action')}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowOverviewModal(false)}
                  className="px-3 py-1 bg-gray-400 text-black rounded hover:bg-gray-500"
                >
                  {t('common:option.cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    setShowOverviewModal(false);
                    setShowSecretModal(true);
                  }}
                  className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  {t('common:option.yes', 'Yes')}
                </button>
              </div>
            </div>
            <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
              {t('common:option.confirm.action.text', 'Are you sure?')}
            </p>

            <table className="min-w-full text-sm mb-4">
              <thead>
                <tr>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetCode')}>
                    {t('common:asset.code', 'Asset code')}
                  </th>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetBalance')}>
                    {t('common:asset.balance', 'Balance')}
                  </th>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetIssuer')}>
                    {t('common:asset.issuer', 'Issuer')}
                  </th>
                  <th className="px-2 py-1">{t('common:option.delete', 'Delete')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedOverview.map((tl, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1">{tl.assetCode}</td>
                    <td className="px-2 py-1">{balanceFmt.format(Number(tl.assetBalance || 0))}</td>
                    <td className="px-2 py-1">{tl.assetIssuer}</td>
                    <td className="px-2 py-1">
                      <button
                        className="text-red-600 hover:underline"
                        onClick={() => handleToggleFromOverview(tl)}
                      >
                        {t('common:option.delete', 'Delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Button-Leiste unten nur anzeigen, wenn gescrollt */}
            {isScrolled && (
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowOverviewModal(false)}
                  className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
                >
                  {t('common:option.cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    setShowOverviewModal(false);
                    setShowSecretModal(true);
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  {t('common:option.yes', 'Yes')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(key) => {
            if (simulationMode) {
              handleDeleteSimulated(key);
            } else {
              handleDeleteTrustlines(key);
            }
          }}
          onCancel={() => setShowSecretModal(false)}
          errorMessage={modalError}
          isProcessing={isProcessing}               // ⬅️ Fortschritt aktiv?
          deleteProgress={deleteProgress}           // ⬅️ Aktueller Fortschritt
        />
      )}

      {isProcessing && (
        <p className="text-blue-600 text-sm mt-2">{t('common:main.processing')}</p>
      )}
      {showResultModal && (
        <ResultModal
          deletedTrustlines={deletedTrustlines}
          isSimulation={isSimulation}
          onClose={() => setShowResultModal(false)}
        />
      )}
      {isProcessing && deleteProgress && (
        <p className="text-sm text-blue-500 mt-2">
          {t('common:trustlines.deleted.deletingProgress', {
            current: deleteProgress.current,
            total: deleteProgress.total,
          })}
        </p>
      )}
      <ErrorModal
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />
  </div>
  );
}

export default ListTrustlines;
