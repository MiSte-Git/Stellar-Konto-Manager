import React from 'react';
import { useTranslation } from 'react-i18next';
import { sortTrustlines, paginateTrustlines } from '../services/stellarUtils';

function ResultDisplay({
  results,
  sortColumn,
  sortDirection,
  onSort,
  currentPage,
  itemsPerPage
}) {
  const { t } = useTranslation();

  if (!results || results.length === 0) return null;
  if (typeof results[0] === 'string') {
    return (
      <div className="mt-4">
        <h2 className="text-xl font-bold">{t('results')}</h2>
        <ul className="list-disc pl-5">
          {results.map((result, index) => (
            <li key={index}>{result}</li>
          ))}
        </ul>
      </div>
    );
  }

  // Sortieren und paginieren
  const sorted = sortTrustlines(results, sortColumn, sortDirection);
  const paged = paginateTrustlines(sorted, currentPage, itemsPerPage);

  // Hilfsfunktion für Sortieranzeige
  const sortIndicator = (column) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="mt-4">
      <h2 className="text-xl font-bold">{t('results')}</h2>
      <table className="table-auto w-full mt-4 border">
        <thead>
          <tr>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('assetCode')}>
              {t('assetCode')}{sortIndicator('assetCode')}
            </th>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('assetIssuer')}>
              {t('issuer')}{sortIndicator('assetIssuer')}
            </th>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('creationDate')}>
              {t('creationDate')}{sortIndicator('creationDate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {paged.map((item, index) => (
            <tr key={index}>
              <td className="border px-2 py-1">{item.assetCode}</td>
              <td className="border px-2 py-1">{item.assetIssuer}</td>
              <td className="border px-2 py-1">{item.createdAt || t('unknownDate')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ResultDisplay;