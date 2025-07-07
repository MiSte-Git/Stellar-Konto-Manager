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

  return (
    <div className="mt-4">
      <table className="w-full table-auto border border-gray-300 dark:border-gray-600 text-sm">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 font-semibold border-b border-gray-300 dark:border-gray-600">
            <th className="p-2 cursor-pointer text-center border-r border-gray-300 dark:border-gray-600" onClick={() => onSort('selected')}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleAll(paginated)}
              />
            </th>
            <th className="p-2 cursor-pointer border-r border-gray-300 dark:border-gray-600" onClick={() => onSort('assetCode')}>{t('assetCode')}</th>
            <th className="p-2 cursor-pointer border-r border-gray-300 dark:border-gray-600" onClick={() => onSort('assetIssuer')}>{t('issuer')}</th>
            <th className="p-2 cursor-pointer" onClick={() => onSort('createdAt')}>{t('creationDate')}</th>
          </tr>
          <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600">
            <th className="border-r border-gray-300 dark:border-gray-600"></th>
            <th className="border-r border-gray-300 dark:border-gray-600">
              <input
                type="text"
                className="w-full border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 px-1"
                placeholder={t('filter')}
                value={filters.assetCode || ''}
                onChange={(e) => onFilterChange('assetCode', e.target.value)}
              />
            </th>
            <th className="border-r border-gray-300 dark:border-gray-600">
              <input
                type="text"
                className="w-full border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 px-1"
                placeholder={t('filter')}
                value={filters.assetIssuer || ''}
                onChange={(e) => onFilterChange('assetIssuer', e.target.value)}
              />
            </th>
            <th>
              <input
                type="text"
                className="w-full border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 px-1"
                placeholder={t('filter')}
                value={filters.createdAt || ''}
                onChange={(e) => onFilterChange('createdAt', e.target.value)}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((tl, index) => (
            <tr
              key={index}
              className={`border-t border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-gray-700 ${isSelected(tl) ? 'bg-blue-100 dark:bg-blue-900 text-gray-900 dark:text-white' : ''}`}
            >
              <td className="p-2 text-center">
                <input
                  type="checkbox"
                  checked={isSelected(tl)}
                  onChange={() => onToggleTrustline(tl)}
                />
              </td>
              <td className="p-2 text-center">{tl.assetCode}</td>
              <td className="p-2 text-center break-all text-xs sm:text-sm">{tl.assetIssuer}</td>
              <td className="p-2 text-center text-xs sm:text-sm">{tl.createdAt || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-between items-center">
        <button
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
          className="px-3 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 border dark:border-gray-500 rounded shadow-sm hover:bg-blue-100 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {t('previous')}
        </button>
        <span className="text-sm text-gray-800 dark:text-gray-100">{t('page')} {currentPage + 1}</span>
        <button
          disabled={(currentPage + 1) * itemsPerPage >= trustlines.length}
          onClick={() => onPageChange(currentPage + 1)}
          className="px-3 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 border dark:border-gray-500 rounded shadow-sm hover:bg-blue-100 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {t('next')}
        </button>
      </div>
    </div>
  );
}

export default ListTrustlines;
