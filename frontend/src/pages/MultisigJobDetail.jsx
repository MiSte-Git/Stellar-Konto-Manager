import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getPendingMultisigJob, mergeSignedXdr } from '../utils/multisigApi.js';
import MultisigJobStatusBadge from '../components/MultisigJobStatusBadge.jsx';

function MultisigJobDetail({ jobId }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [importXdr, setImportXdr] = useState('');
  const [importing, setImporting] = useState(false);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getPendingMultisigJob(jobId);
      setJob(data);
      setInfo('');
    } catch (e) {
      setError(e?.message || 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  const handleMerge = useCallback(async () => {
    if (!jobId || !importXdr.trim()) return;
    setImporting(true);
    setError('');
    try {
      const data = await mergeSignedXdr({ jobId, signedXdr: importXdr.trim() });
      setJob(data);
      setImportXdr('');
      setInfo(t('multisig:job.detail.signedXdr.success.body', { status: data?.status || '' }));
    } catch (e) {
      const raw = e?.message || 'merge_failed';
      if (raw === 'mismatched_hash') {
        setError(t('multisig:errors.mismatchedHash'));
      } else {
        setError(raw);
      }
    } finally {
      setImporting(false);
    }
  }, [importXdr, jobId, t]);

  if (!jobId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('multisig:detail.title', 'Pending Multisig Job')}</h1>
          {job?.status && <MultisigJobStatusBadge status={job.status} />}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-sm px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={fetchJob}
            disabled={loading}
          >
            {t('common:refresh', 'Refresh')}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {info && <div className="text-sm text-green-700 dark:text-green-400">{info}</div>}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}

      {job && (
        <div className="space-y-3">
          <div className="border rounded p-3 text-sm">
            <div className="font-mono break-all text-xs text-gray-600 dark:text-gray-300">ID: {job.id}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              <span className="text-gray-700 dark:text-gray-200">{t('common:network', 'Netzwerk')}: {job.network}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:account.source', 'Quelle')}: <span className="font-mono break-all">{job.accountId}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:prepare.hashLabel')}: <span className="font-mono break-all">{job.txHash}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.statusLabel', 'Status')}: {job.status}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdAt', 'Angelegt')}: {job.createdAt}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdBy', 'Erstellt von')}: {job.createdBy}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.updatedAt', 'Aktualisiert am')}: {job.updatedAt || '-'}</span>
            </div>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 space-y-1">
              <div>{t('multisig:detail.signers.required')}: {job.requiredSigners ?? '-'}</div>
              <div>{t('multisig:detail.signers.collected')}: {job.collectedSigners ?? '-'}</div>
              {job.requiredSigners && job.collectedSigners != null && (
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {t('multisig:detail.signatures.progress.count', { collected: job.collectedSigners, required: job.requiredSigners })}
                </div>
              )}
            </div>
            {job.status && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                {t(`multisig:job.statusHelp.${job.status}`, t('multisig:job.statusHelp.unknown'))}
              </div>
            )}
          </div>

          {Array.isArray(job.changes) && job.changes.length > 0 && (
            <div className="border rounded p-3">
              <div className="font-semibold mb-2">{t('multisig:detail.changes.title')}</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {job.changes.map((c, idx) => {
                  if (c.type === 'set_signer') return <li key={idx}>{t('multisig:detail.changes.addSigner', { account: c.accountId || c.account || '', weight: c.weight ?? c.value ?? 0 })}</li>;
                  if (c.type === 'remove_signer') return <li key={idx}>{t('multisig:detail.changes.removeSigner', { account: c.accountId || c.account || '' })}</li>;
                  if (c.type === 'set_threshold' || c.type === 'set_thresholds') return <li key={idx}>{t('multisig:detail.changes.setThresholds', { low: c.low ?? c.lowThreshold ?? c.thresholds?.low ?? '-', med: c.med ?? c.medThreshold ?? c.thresholds?.med ?? '-', high: c.high ?? c.highThreshold ?? c.thresholds?.high ?? '-' })}</li>;
                  return <li key={idx}>{c.type}</li>;
                })}
              </ul>
            </div>
          )}

          <div className="border rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm">{t('multisig:detail.xdr.title')}</h2>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(job.txXdrCurrent || job.txXdr || '');
                    setInfo(t('multisig:detail.xdr.copy.success'));
                  } catch {
                    setError(t('multisig:detail.xdr.copy.error'));
                  }
                }}
              >
                {t('multisig:detail.xdr.copy')}
              </button>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">{t('multisig:detail.xdr.hint')}</p>
            <textarea className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1" readOnly value={job.txXdrCurrent || job.txXdr || ''} />
          </div>

          <div className="border rounded p-3 space-y-2">
            <div>
              <h3 className="font-semibold text-sm">{t('multisig:detail.signedXdr.title')}</h3>
              <p className="text-xs text-gray-700 dark:text-gray-300">{t('multisig:detail.signedXdr.hint')}</p>
            </div>
            <textarea
              className="w-full h-24 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1"
              placeholder={t('multisig:detail.signedXdr.label')}
              value={importXdr}
              onChange={(e) => setImportXdr(e.target.value)}
            />
            <button
              type="button"
              className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
              onClick={handleMerge}
              disabled={importing || !importXdr.trim()}
            >
              {importing ? t('common:common.loading') : t('multisig:detail.signedXdr.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultisigJobDetail;
