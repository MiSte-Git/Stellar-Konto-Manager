import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BACKEND_URL } from '../../config';

export default function AssetSearch() {
  const { t } = useTranslation(['trading', 'common']);
  const [assetCode, setAssetCode] = useState('');
  const [assetIssuer, setAssetIssuer] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  const [assetError, setAssetError] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);

  const handleAssetSearch = async (e) => {
    e.preventDefault();
    const code = assetCode.trim();
    const issuer = assetIssuer.trim();
    if (!code) {
      setAssetError(t('trading:assetSearch.invalidInput.codeMissing'));
      return;
    }
    setAssetError('');
    setAssetResults([]);
    setAssetLoading(true);
    try {
      const baseUrl = BACKEND_URL || '';
      const searchUrl = `${baseUrl}/api/trade/assets/search?code=${encodeURIComponent(code)}${issuer ? `&issuer=${encodeURIComponent(issuer)}` : ''}`;
      const resp = await fetch(searchUrl);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = data?.error || 'assetSearch.failed:generic';
        throw new Error(message);
      }
      setAssetResults(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.startsWith('assetSearch.invalidInput:codeMissing')) {
        setAssetError(t('trading:assetSearch.invalidInput.codeMissing'));
      } else {
        setAssetError(t('trading:assetSearch.failed.generic'));
      }
    } finally {
      setAssetLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('trading:assetSearch.title')}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t('trading:assetSearch.description', 'Suche nach Assets über den Horizon-basierten Trading-Endpunkt.')}
      </p>
      <form className="space-y-3" onSubmit={handleAssetSearch}>
        <div className="flex flex-col md:flex-row gap-3 items-start">
          <label className="text-sm md:w-48" htmlFor="asset-code-input">
            {t('trading:assetSearch.form.code.label')}
          </label>
          <input
            id="asset-code-input"
            className="border rounded px-2 py-1 w-full md:max-w-xs"
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value)}
            placeholder={t('trading:assetSearch.form.code.placeholder', 'z. B. USDC')}
          />
        </div>
        <div className="flex flex-col md:flex-row gap-3 items-start">
          <label className="text-sm md:w-48" htmlFor="asset-issuer-input">
            {t('trading:assetSearch.form.issuer.label')}
          </label>
          <input
            id="asset-issuer-input"
            className="border rounded px-2 py-1 w-full"
            value={assetIssuer}
            onChange={(e) => setAssetIssuer(e.target.value)}
            placeholder={t('trading:assetSearch.form.issuer.placeholder', 'optional')}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={assetLoading}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {assetLoading ? t('common:loading', 'Loading…') : t('trading:assetSearch.form.submit')}
          </button>
          {assetError && (
            <span className="text-sm text-red-600">{assetError}</span>
          )}
        </div>
      </form>

      <div className="border rounded px-3 py-2">
        {assetResults.length === 0 && !assetError && !assetLoading && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {t('trading:assetSearch.result.empty')}
          </div>
        )}
        {assetResults.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.code')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.issuer')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.numAccounts', 'Accounts')}</th>
                  <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.amount', 'Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {assetResults.map((r, idx) => (
                  <tr key={`${r.assetCode}-${r.assetIssuer}-${idx}`} className="border-t">
                    <td className="py-1 pr-3 font-mono">{r.assetCode}</td>
                    <td className="py-1 pr-3 font-mono break-all">{r.assetIssuer || '—'}</td>
                    <td className="py-1 pr-3">{r.numAccounts ?? '—'}</td>
                    <td className="py-1 pr-3">{r.amount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
