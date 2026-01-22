import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getPendingMultisigJob, mergeSignedXdr } from '../utils/multisigApi.js';
import MultisigJobStatusBadge from '../components/MultisigJobStatusBadge.jsx';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

function MultisigJobDetail({ jobId, onBack, currentPublicKey }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [importXdr, setImportXdr] = useState('');
  const [importing, setImporting] = useState(false);
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [secretInput, setSecretInput] = useState('');

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

  const collectedSet = useMemo(() => new Set((job?.collectedSigners || []).map((s) => s.publicKey)), [job]);
  const shortPk = useCallback((pk) => {
    const val = pk || '';
    if (val.length <= 16) return val || t('multisig:list.signer.unknown', 'Signer');
    return `${val.slice(0, 8)}…${val.slice(-8)}`;
  }, [t]);

  const canCurrentSign = useMemo(() => {
    if (!currentPublicKey) return false;
    return !!(job?.signers || []).find((s) => (s.publicKey || '') === currentPublicKey && Number(s.weight || 0) > 0);
  }, [job, currentPublicKey]);
  const signingComplete = useMemo(() => {
    const req = Number(job?.requiredWeight || 0);
    const have = Number(job?.collectedWeight || 0);
    return req > 0 && have >= req;
  }, [job]);
  const submitError = job?.submittedResult?.error;
  const submitExtras = job?.submittedResult?.detail?.extras;
  const isFinalState = useMemo(() => {
    const s = String(job?.status || '').toLowerCase();
    return ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'].includes(s);
  }, [job]);

  const signWithSecret = useCallback(async (secret) => {
    if (!job) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    try {
      setLoading(true);
      const netPass = (job.network === 'testnet' || job.network === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC;
      const tx = TransactionBuilder.fromXDR(job.txXdrCurrent || job.txXdrOriginal || job.txXdr || '', netPass);
      const kp = Keypair.fromSecret(secret);
      tx.sign(kp);
      const signerMeta = (job.signers || []).map((s) => ({
        publicKey: s.publicKey,
        weight: Number(s.weight || 0),
      })).filter((s) => s.publicKey && s.weight > 0);
      const clientCollected = [{
        publicKey: kp.publicKey(),
        weight: signerMeta.find((s) => s.publicKey === kp.publicKey())?.weight ?? 0,
      }];
      const merged = await mergeSignedXdr({
        jobId,
        signedXdr: tx.toXDR(),
        clientCollected,
        signers: signerMeta,
      });
      setJob(merged);
      const st = merged?.status || 'pending_signatures';
      setInfo(t('multisig:detail.signatures.signedLocalStatus', { status: st }));
      const submitErr = merged?.submittedResult?.error;
      if (submitErr) {
        setError(t('multisig:detail.submitFailed', { reason: submitErr }));
      } else {
        setError('');
      }
      setShowSecretPrompt(false);
      setSecretInput('');
    } catch (e) {
      setError(String(e?.message || 'multisig.jobs.merge_failed'));
    } finally {
      setLoading(false);
    }
  }, [job, jobId, canCurrentSign, t]);

  const handleSignWithSession = useCallback(async () => {
    if (!job) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    const secret = (() => {
      try { return sessionStorage.getItem(`stm.session.secret.${currentPublicKey}`) || ''; } catch { return ''; }
    })();
    if (!secret) {
      setError(t('multisig:detail.noSessionSecret', 'Kein Secret Key im Browser gespeichert. Bitte Secret eingeben oder signiertes XDR importieren.'));
      setShowSecretPrompt(true);
      return;
    }
    await signWithSecret(secret);
  }, [job, canCurrentSign, currentPublicKey, t, signWithSecret]);

  if (!jobId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('multisig:detail.title', 'Pending Multisig Job')}</h1>
          {job?.status && <MultisigJobStatusBadge status={job.status} />}
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              className="text-sm px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => {
                try { onBack(); } catch { /* noop */ }
              }}
            >
              {t('common:option.back', 'Zurück')}
            </button>
          )}
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
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.network', 'Netzwerk')}: {job.network}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:account.source', 'Quelle')}: <span className="font-mono break-all">{job.accountId}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:prepare.hashLabel')}: <span className="font-mono break-all">{job.txHash}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.statusLabel', 'Status')}: {job.status}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdAt', 'Angelegt')}: {job.createdAt}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdBy', 'Erstellt von')}: {job.createdBy || '-'}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.updatedAt', 'Aktualisiert am')}: {job.updatedAt || '-'}</span>
            </div>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 space-y-1">
              <div className="font-semibold">{t('multisig:detail.signatures.title', 'Signaturen')}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('multisig:detail.signatures.progress', {
                  collected: job.collectedWeight ?? 0,
                  required: job.requiredWeight ?? 0,
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {(job?.signers || []).map((s) => {
                  const pk = s.publicKey || '';
                  const signed = collectedSet.has(pk);
                  return (
                    <span
                      key={pk || Math.random()}
                      className={`px-2 py-0.5 rounded text-xs ${signed ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'}`}
                      title={pk}
                    >
                      {shortPk(pk)}
                      {' '}
                      {signed ? t('multisig:detail.signatures.signed', 'unterzeichnet') : t('multisig:detail.signatures.missing', 'fehlt')}
                    </span>
                  );
                })}
              </div>
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

          {canCurrentSign && !isFinalState && (
            <div className="flex items-center justify-between gap-3 border rounded p-3">
              <div className="text-sm font-semibold">{t('multisig:detail.signers.signWithSession', 'Jetzt signieren')}</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded border border-green-200 text-green-700 dark:text-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900"
                onClick={handleSignWithSession}
                disabled={loading || signingComplete}
              >
                {t('multisig:detail.signers.signWithSession', 'Jetzt signieren')}
              </button>
            </div>
          )}

          {showSecretPrompt && canCurrentSign && !isFinalState && (
            <div className="border border-amber-500 rounded p-3 space-y-3 bg-amber-50 dark:bg-amber-900/40 shadow-sm">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {t('multisig:detail.secretPrompt.title', 'Secret eingeben, um zu signieren')}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300">
                {t('multisig:detail.secretPrompt.hint', { account: currentPublicKey })}
              </div>
              <input
                type="password"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                className="w-full border-2 border-amber-500 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
                autoComplete="off"
                spellCheck="false"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                  onClick={() => { setShowSecretPrompt(false); setSecretInput(''); }}
                  disabled={loading}
                >
                  {t('common:cancel', 'Abbrechen')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50"
                  onClick={() => signWithSecret(secretInput.trim())}
                  disabled={loading || !secretInput.trim()}
                >
                  {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
                </button>
              </div>
            </div>
          )}
          {submitError && (
            <div className="border border-red-400 bg-red-50 dark:bg-red-900/30 text-xs text-red-800 dark:text-red-200 rounded p-2 space-y-1">
              <div>{t('multisig:detail.submitFailed', { reason: submitError })}</div>
              {submitExtras && submitExtras.result_codes && (
                <div className="font-mono break-all">
                  {JSON.stringify(submitExtras.result_codes)}
                </div>
              )}
              {!submitExtras && (
                <div className="text-gray-700 dark:text-gray-300">
                  {t('multisig:detail.submitNoExtras', 'Keine weiteren Fehlerdetails verfügbar.')}
                </div>
              )}
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
