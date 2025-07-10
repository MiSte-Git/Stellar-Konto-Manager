// src/components/ListTrustlines.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { validateSecretKey } from '../services/stellarUtils';
import SecretKeyModal from './SecretKeyModal';

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
  setMenuSelection
}) {
  const { t } = useTranslation();
  const [paginated, setPaginated] = useState([]);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [overviewSort, setOverviewSort] = useState({ column: 'assetCode', direction: 'asc' });

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
      const count = selectedTrustlines.length;
      setResults([`${count} Trustlines wurden simuliert gelöscht.`]);
      setSelectedTrustlines([]);
    } catch (err) {
      setError(t(err.message)); // Nutze jetzt globales setError
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
      <button
        onClick={() => setMenuSelection(null)}
        className="mb-4 px-3 py-1 bg-gray-300 dark:bg-gray-700 text-black dark:text-white rounded hover:bg-gray-400 dark:hover:bg-gray-600"
      >
        {t('navigation.backToMainMenu')}
      </button>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
        {t('trustline.list')}: {trustlines?.length || 0}
      </p>

      {selectedTrustlines.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setShowOverviewModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('trustline.delete')}
          </button>
        </div>
      )}

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
            handleDeleteSimulated(key);
          }}
          onCancel={() => setShowSecretModal(false)}
        />
      )}
    </div>
  );
}

export default ListTrustlines;
