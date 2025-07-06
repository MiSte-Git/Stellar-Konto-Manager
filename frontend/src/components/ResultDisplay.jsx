import React from 'react';
import { useTranslation } from 'react-i18next';

function ResultDisplay({ results}) {
  const { t } = useTranslation();
  
  if (!results || results.length === 0) return null;

  return (
    <div className="mt-4">
      <h2 className="text-xl font-bold">{t('results')}</h2>
      {typeof results[0] === 'string' ? (
        <ul className="list-disc pl-5">
          {results.map((result, index) => (
            <li key={index}>{result}</li>
          ))}
        </ul>
      ) : (
        <table className="table-auto w-full mt-4 border">
          <thead>
            <tr>
              <th className="border px-2 py-1">{t('assetCode')}</th>
              <th className="border px-2 py-1">{t('issuer')}</th>
              <th className="border px-2 py-1">{t('creationDate')}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item, index) => (
              <tr key={index}>
                <td className="border px-2 py-1">{item.asset_code}</td>
                <td className="border px-2 py-1">{item.asset_issuer}</td>
                <td className="border px-2 py-1">
                  {item.created_at || t('unknownDate')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default ResultDisplay;
