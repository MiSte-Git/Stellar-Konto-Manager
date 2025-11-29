import React from 'react';
import { useTranslation } from 'react-i18next';
import { sortTrustlines, paginateTrustlines } from '../utils/stellar/stellarUtils';

function ResultDisplay({
  results,
  sortColumn,
  sortDirection,
  onSort,
  currentPage,
  itemsPerPage
}) {
  const { t } = useTranslation(['common', 'errors']);

  if (!results || results.length === 0) return null;
  if (typeof results[0] === 'string') {
    return (
      <div className="mt-4">
        {/* Titelzeile: Bei Textmeldungen zählen wir 0 gefundene Trustlines */}
        <h2 className="text-xl font-bold">
          {t('common:option.results', 'Results:')} (0)
        </h2>
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
      <h2 className="text-xl font-bold">{t('common:option.results', 'Results:')}</h2>
      <table className="table-auto w-full mt-4 border">
        <thead>
          <tr>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('assetCode')}>
              {t('common:asset.code', 'Asset code')}{sortIndicator('assetCode')}
            </th>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('assetIssuer')}>
              {t('common:asset.issuer', 'Issuer')}{sortIndicator('assetIssuer')}
            </th>
            <th className="border px-2 py-1 cursor-pointer" onClick={() => onSort('creationDate')}>
              {t('common:asset.creationDate', 'Created at')}{sortIndicator('creationDate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {paged.map((item, index) => (
            <tr key={index}>
              <td className="border px-2 py-1">{item.assetCode}</td>
              <td className="border px-2 py-1">{item.assetIssuer}</td>
              <td className="border px-2 py-1">{item.createdAt || t('errors:asset.creationDateUnknown', 'Unknown creation date')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ResultDisplay;