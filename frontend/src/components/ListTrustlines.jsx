// src/components/ListTrustlines.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
  onToggleAll
}) {
  const { t } = useTranslation();
  const [paginated, setPaginated] = useState([]);

  useEffect(() => {
    // Filter anwenden
    let filtered = trustlines.filter((tl) => {
      return (
        (!filters.assetCode || tl.assetCode.toLowerCase().includes(filters.assetCode.toLowerCase())) &&
        (!filters.assetIssuer || tl.assetIssuer.toLowerCase().includes(filters.assetIssuer.toLowerCase())) &&
        (!filters.createdAt || tl.createdAt?.toLowerCase().includes(filters.createdAt.toLowerCase()))
      );
    });

    // Sortierung anwenden
    filtered.sort((a, b) => {
      const isAsc = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'selected') {
        return (selectedTrustlines.includes(a) === selectedTrustlines.includes(b)) ? 0 : selectedTrustlines.includes(a) ? -1 * isAsc : 1 * isAsc;
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

    // Pagination anwenden
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    setPaginated(filtered.slice(start, end));
  }, [trustlines, filters, sortColumn, sortDirection, currentPage, itemsPerPage, selectedTrustlines]);

  // Prüfe, ob alle angezeigten Trustlines ausgewählt sind
  const allSelected = paginated.length > 0 && paginated.every(tl => selectedTrustlines.includes(tl));

  return (
    <div className="mt-4">
      <table className="w-full table-auto border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="p-2 cursor-pointer" onClick={() => onSort('selected')}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleAll(paginated)}
              />
            </th>
            <th className="p-2 cursor-pointer" onClick={() => onSort('assetCode')}>{t('assetCode')}</th>
            <th className="p-2 cursor-pointer" onClick={() => onSort('assetIssuer')}>{t('assetIssuer')}</th>
            <th className="p-2 cursor-pointer" onClick={() => onSort('createdAt')}>{t('createdAt')}</th>
          </tr>
          <tr>
            <th></th>
            <th>
              <input
                type="text"
                className="w-full border px-1"
                value={filters.assetCode || ''}
                onChange={(e) => onFilterChange('assetCode', e.target.value)}
              />
            </th>
            <th>
              <input
                type="text"
                className="w-full border px-1"
                value={filters.assetIssuer || ''}
                onChange={(e) => onFilterChange('assetIssuer', e.target.value)}
              />
            </th>
            <th>
              <input
                type="text"
                className="w-full border px-1"
                value={filters.createdAt || ''}
                onChange={(e) => onFilterChange('createdAt', e.target.value)}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((tl, index) => (
            <tr key={index} className="border-t border-gray-300">
              <td className="p-2 text-center">
                <input
                  type="checkbox"
                  checked={selectedTrustlines.includes(tl)}
                  onChange={() => onToggleTrustline(tl)}
                />
              </td>
              <td className="p-2 text-center">{tl.assetCode}</td>
              <td className="p-2 text-center">{tl.assetIssuer}</td>
              <td className="p-2 text-center">{tl.createdAt || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-between">
        <button disabled={currentPage === 0} onClick={() => onPageChange(currentPage - 1)} className="px-2 py-1 bg-gray-200 rounded">
          {t('previous')}
        </button>
        <span>{t('page')} {currentPage + 1}</span>
        <button disabled={(currentPage + 1) * itemsPerPage >= trustlines.length} onClick={() => onPageChange(currentPage + 1)} className="px-2 py-1 bg-gray-200 rounded">
          {t('next')}
        </button>
      </div>
    </div>
  );
}

export default ListTrustlines;
