import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BACKEND_URL } from '../config.js';
import { buildPath } from '../utils/basePath.js';

function MultisigJobList({ onBack }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const netLabel = (() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'testnet' : 'public'; } catch { return 'public'; }
  })();

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${BACKEND_URL}/api/multisig/jobs?network=${encodeURIComponent(netLabel)}`);
      const data = await r.json().catch(() => ([]));
      if (!r.ok) throw new Error(data?.error || 'multisig.jobs.list_failed');
      setJobs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'multisig.jobs.list_failed');
    } finally {
      setLoading(false);
    }
  }, [netLabel]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const renderStatus = (status) => t(`multisig:list.status.${status}`, status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('multisig:list.title')}</h1>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded border" onClick={onBack}>{t('common:option.back', 'Zurück')}</button>
          <button className="px-3 py-1 rounded border" onClick={loadJobs} disabled={loading}>{t('common:refresh', 'Refresh')}</button>
        </div>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}
      {(!jobs || jobs.length === 0) && !loading && (
        <div className="text-sm text-gray-600">{t('multisig:list.empty')}</div>
      )}
      {jobs && jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="px-2 py-1">{t('multisig:detail.accountLabel')}</th>
                <th className="px-2 py-1">{t('multisig:detail.txHashLabel')}</th>
                <th className="px-2 py-1">{t('multisig:detail.statusLabel')}</th>
                <th className="px-2 py-1">{t('common:createdAt', 'Angelegt')}</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="px-2 py-1 font-mono break-all">{j.accountId}</td>
                  <td className="px-2 py-1 font-mono break-all">{(j.txHash || '').slice(0, 12)}…</td>
                  <td className="px-2 py-1">{renderStatus(j.status)}</td>
                  <td className="px-2 py-1">{j.createdAt}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="text-blue-700 dark:text-blue-200 hover:underline"
                      onClick={() => {
                        try {
                          const url = buildPath(`multisig/jobs/${j.id}`);
                          window.history.pushState({}, '', url);
                          window.dispatchEvent(new PopStateEvent('popstate'));
                        } catch (e) {
                          console.error('nav failed', e);
                        }
                      }}
                    >
                      {t('multisig:list.details', 'Details anzeigen')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MultisigJobList;
