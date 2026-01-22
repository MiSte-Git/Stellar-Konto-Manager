import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl } from '../utils/apiBase.js';
import { buildPath } from '../utils/basePath.js';

function MultisigJobList({ onBack, publicKey, onOpenDetail }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyPendingForMe, setOnlyPendingForMe] = useState(false);
  const [includeSignerJobs, setIncludeSignerJobs] = useState(true);
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const netLabel = (() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'testnet' : 'public'; } catch { return 'public'; }
  })();

  const accountId = (() => {
    const direct = (publicKey || '').trim();
    if (direct) return direct;
    try { return (window.localStorage?.getItem('SKM_LAST_ACCOUNT') || '').trim(); } catch { return ''; }
  })();

  const loadJobs = useCallback(async () => {
    if (!accountId) {
      setJobs([]);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const queries = [
        apiUrl(`multisig/jobs?network=${encodeURIComponent(netLabel)}&accountId=${encodeURIComponent(accountId)}`)
      ];
      if (includeSignerJobs) {
        queries.push(apiUrl(`multisig/jobs?network=${encodeURIComponent(netLabel)}&signer=${encodeURIComponent(accountId)}`));
      }
      const results = await Promise.all(queries.map(async (url) => {
        const r = await fetch(url);
        const data = await r.json().catch(() => ([]));
        if (!r.ok) throw new Error(data?.error || 'multisig.jobs.list_failed');
        return Array.isArray(data) ? data : [];
      }));
      const merged = [];
      const seen = new Set();
      results.flat().forEach((j) => {
        const id = j?.id || j?.jobId;
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(j);
      });
      setJobs(merged);
    } catch (e) {
      setError(e?.message || 'multisig.jobs.list_failed');
    } finally {
      setLoading(false);
    }
  }, [netLabel, accountId, includeSignerJobs]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const renderStatus = (status) => t(`multisig:list.status.${status}`, status);

  const jobsToShow = useMemo(() => {
    if (!onlyPendingForMe || !accountId) return jobs;
    return jobs.filter((j) => Array.isArray(j?.missingSigners) && j.missingSigners.some((s) => (s.publicKey || '') === accountId));
  }, [jobs, onlyPendingForMe, accountId]);

  const handleExport = () => {
    try {
      const payload = JSON.stringify(jobsToShow || [], null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `multisig-jobs-${netLabel}-${accountId || 'unknown'}-${ts}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('export failed', e);
    }
  };

  const handleDeleteTestnet = async () => {
    if (netLabel !== 'testnet') return;
    setLoading(true);
    setError('');
    try {
      const url = apiUrl(`multisig/jobs?network=${encodeURIComponent(netLabel)}&confirm=${encodeURIComponent('DELETE TESTNET JOBS')}`);
      const r = await fetch(url, { method: 'DELETE' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || 'delete_failed');
      await loadJobs();
      setDeleteConfirm('');
      setShowDeletePanel(false);
    } catch (e) {
      setError(e?.message || 'delete_failed');
    } finally {
      setLoading(false);
    }
  };

  const renderSignerBadges = (job) => {
    const collected = new Set((job?.collectedSigners || []).map((s) => s.publicKey));
    const shortPk = (pk) => {
      const val = pk || '';
      if (val.length <= 16) return val || t('multisig:list.signer.unknown', 'Signer');
      return `${val.slice(0, 8)}…${val.slice(-8)}`;
    };
    return (
      <div className="flex flex-wrap gap-1">
        {(job?.signers || []).map((s) => {
          const pk = s.publicKey || '';
          const signed = collected.has(pk);
          const short = shortPk(pk);
          return (
            <span
              key={pk || Math.random()}
              className={`px-2 py-0.5 rounded text-xs ${signed ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'}`}
              title={pk}
            >
              {short || t('multisig:list.signer.unknown', 'Signer')}
              {' '}
              {signed ? t('multisig:list.signer.signed', '✓') : t('multisig:list.signer.missing', '…')}
            </span>
          );
        })}
      </div>
    );
  };

  if (!accountId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('multisig:list.title')}</h1>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border" onClick={onBack}>{t('common:option.back', 'Zurück')}</button>
          </div>
        </div>
        <div className="text-sm text-gray-700 dark:text-gray-200">
          {t('multisig:list.noAccount', 'Bitte lade zuerst ein Konto.')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('multisig:list.title')}</h1>
        <div className="flex gap-2">
          {accountId && (
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={onlyPendingForMe}
                onChange={(e) => setOnlyPendingForMe(!!e.target.checked)}
              />
              {t('multisig:list.filter.mine', 'Nur Aufträge, die ich noch signieren muss')}
            </label>
          )}
          {accountId && (
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={includeSignerJobs}
                onChange={(e) => setIncludeSignerJobs(!!e.target.checked)}
              />
              {t('multisig:list.filter.assigned', 'Auch Aufträge, bei denen ich Signer bin')}
            </label>
          )}
          <button className="px-3 py-1 rounded border" onClick={onBack}>{t('common:option.back', 'Zurück')}</button>
          <button className="px-3 py-1 rounded border" onClick={loadJobs} disabled={loading}>{t('common:refresh', 'Refresh')}</button>
          <button className="px-3 py-1 rounded border" onClick={handleExport} disabled={!jobsToShow || jobsToShow.length === 0 || loading}>
            {t('multisig:list.export', 'Exportieren')}
          </button>
          {netLabel === 'testnet' && (
            <button
              className="px-3 py-1 rounded border border-red-400 text-red-700"
              onClick={() => setShowDeletePanel((v) => !v)}
              disabled={loading}
            >
              {t('multisig:list.deleteTestnet', 'Testnet-Jobs löschen')}
            </button>
          )}
        </div>
      </div>
      {showDeletePanel && netLabel === 'testnet' && (
        <div className="border border-red-400 bg-red-50 dark:bg-red-900/30 rounded p-3 space-y-2">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">
            {t('multisig:list.deleteTestnetTitle', 'Alle Testnet-Jobs löschen')}
          </div>
          <div className="text-xs text-red-700 dark:text-red-300">
            {t('multisig:list.deleteTestnetHint', 'Dies entfernt alle Multisig-Jobs im Testnet. Zum Bestätigen bitte "DELETE TESTNET JOBS" eintippen.')}
          </div>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="DELETE TESTNET JOBS"
            autoComplete="off"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded border"
              onClick={() => { setShowDeletePanel(false); setDeleteConfirm(''); }}
              disabled={loading}
            >
              {t('common:cancel', 'Abbrechen')}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50"
              onClick={handleDeleteTestnet}
              disabled={loading || deleteConfirm !== 'DELETE TESTNET JOBS'}
            >
              {t('multisig:list.deleteTestnetConfirm', 'Testnet-Jobs löschen')}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}
      {(!jobsToShow || jobsToShow.length === 0) && !loading && (
        <div className="text-sm text-gray-600">{t('multisig:list.empty')}</div>
      )}
      {jobsToShow && jobsToShow.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="px-2 py-1">{t('multisig:detail.accountLabel')}</th>
                <th className="px-2 py-1">{t('multisig:detail.txHashLabel')}</th>
                <th className="px-2 py-1">{t('multisig:detail.statusLabel')}</th>
                <th className="px-2 py-1">{t('multisig:list.signatures', 'Signaturen')}</th>
                <th className="px-2 py-1">{t('common:createdAt', 'Angelegt')}</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {jobsToShow.map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="px-2 py-1 font-mono break-all">{j.accountId}</td>
                  <td className="px-2 py-1 font-mono break-all">{(j.txHash || '').slice(0, 12)}…</td>
                  <td className="px-2 py-1">{renderStatus(j.status)}</td>
                  <td className="px-2 py-1">
                    <div className="text-xs text-gray-700 dark:text-gray-300">
                      {t('multisig:list.signaturesProgress', {
                        collected: j.collectedWeight ?? 0,
                        required: j.requiredWeight ?? 0,
                      })}
                    </div>
                    {renderSignerBadges(j)}
                  </td>
                  <td className="px-2 py-1">{j.createdAt}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="text-blue-700 dark:text-blue-200 hover:underline"
                      onClick={() => {
                        if (onOpenDetail) {
                          onOpenDetail(j.id);
                        } else {
                          try {
                            const url = buildPath(`multisig/jobs/${j.id}`);
                            window.history.pushState({}, '', url);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                          } catch (e) {
                            console.error('nav failed', e);
                          }
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
