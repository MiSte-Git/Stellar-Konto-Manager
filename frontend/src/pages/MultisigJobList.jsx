import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Keypair } from '@stellar/stellar-sdk';
import { apiUrl } from '../utils/apiBase.js';
import { FINAL_JOB_STATUSES, needsSignatureFrom } from '../utils/multisig/jobSigningState.js';
import { readHiddenJobIds, writeHiddenJobIds } from '../utils/multisig/hiddenJobs.js';
import { deleteMultisigJob, getMultisigJobChallenge, signMultisigJobChallenge } from '../utils/multisigApi.js';
import { getSessionSecret } from '../utils/sessionSecrets.js';

// Eigene Button-Klassen: ohne bg-/px-Klassen greift der globale button-Stil aus index.css
// (dunkler Hintergrund, grosses Padding) und die Buttons passen nicht zum Rest der App.
const BTN = 'rounded-sm border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_DANGER = 'rounded-sm border border-red-300 bg-white px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-200 dark:hover:bg-red-950';
const BTN_ROW_PRIMARY = 'rounded-sm border border-blue-600 bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap';
const BTN_ROW_SECONDARY = 'rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-50 whitespace-nowrap dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
// Jobs, die nie mehr gueltig werden koennen: kein Signieren mehr anbieten.
const DEAD_JOB_STATUSES = new Set(['obsolete_seq', 'expired']);
const BTN_ROW_LINK = 'rounded-sm border-0 bg-transparent px-1 py-0.5 text-xs text-gray-600 hover:underline dark:bg-transparent dark:text-gray-300 whitespace-nowrap';

// Netzwerkfehler von fetch: Chrome 'Failed to fetch', Safari/WebKit 'Load failed', Firefox 'NetworkError ...'.
function isNetworkError(message) {
  return /failed to fetch|load failed|networkerror|network request failed/i.test(String(message || ''));
}

function MultisigJobList({ onBack, publicKey, onOpenDetail, refreshKey = 0 }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyPendingForMe, setOnlyPendingForMe] = useState(false);
  const [includeSignerJobs, setIncludeSignerJobs] = useState(true);
  // Ausblenden (nur lokal) und Loeschen abgeschlossener Jobs (Auswahl).
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deletePanel, setDeletePanel] = useState(null); // { needsKey } solange offen
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteResult, setDeleteResult] = useState(null); // { deleted, failed: [{ id, reason }], stopped }
  // Sofortige Sperre gegen Doppelklick: der State greift erst nach dem naechsten Render.
  const deleteInFlightRef = useRef(false);

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
      // "Nur Auftraege, die ich noch signieren muss" schliesst fremde Konten mit ein, bei denen
      // ich Signer bin: genau dort fehlt meine Signatur meistens.
      if (includeSignerJobs || onlyPendingForMe) {
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
  }, [netLabel, accountId, includeSignerJobs, onlyPendingForMe]);

  // refreshKey: nach dem Schliessen eines Jobs neu laden (Status kann sich geaendert haben).
  useEffect(() => { void loadJobs(); }, [loadJobs, refreshKey]);
  useEffect(() => {
    setHiddenIds(readHiddenJobIds(netLabel, accountId));
    setSelected(new Set());
    setDeletePanel(null);
    setDeleteResult(null);
  }, [netLabel, accountId]);

  const renderStatus = (status) => t(`multisig:list.status.${status}`, status);

  const jobsToShow = useMemo(() => {
    const visible = showHidden ? jobs : jobs.filter((j) => !hiddenIds.has(j.id));
    if (!onlyPendingForMe || !accountId) return visible;
    return visible.filter((j) => needsSignatureFrom(j, accountId));
  }, [jobs, onlyPendingForMe, accountId, hiddenIds, showHidden]);
  const hiddenCount = useMemo(() => jobs.filter((j) => hiddenIds.has(j.id)).length, [jobs, hiddenIds]);
  const isDeletable = (j) => FINAL_JOB_STATUSES.has(String(j?.status || ''));
  const deletableShown = useMemo(() => jobsToShow.filter(isDeletable), [jobsToShow]);
  const selectedShown = useMemo(() => deletableShown.filter((j) => selected.has(j.id)), [deletableShown, selected]);

  const toggleHidden = (id) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeHiddenJobIds(netLabel, accountId, next);
      return next;
    });
  };
  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = deletableShown.length > 0 && selectedShown.length === deletableShown.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(deletableShown.map((j) => j.id)));

  // Loeschen: je Job eine Challenge holen, mit dem Key des geladenen Kontos und Zweck
  // `delete` signieren und loeschen. Das Backend loescht nur Jobs im Endzustand und nur fuer
  // aktuelle Signer des Job-Kontos (live geprueft); ein Job-Token wird dafuer nicht gebraucht.
  const openDeletePanel = async () => {
    setDeleteError('');
    setDeleteInput('');
    setDeleteResult(null);
    const stored = await getSessionSecret(accountId, accountId);
    setDeletePanel({ needsKey: !stored });
  };
  const deleteSelected = async () => {
    if (deleteInFlightRef.current || deleting || !selectedShown.length) return;
    deleteInFlightRef.current = true;
    try {
      await runDelete();
    } finally {
      deleteInFlightRef.current = false;
    }
  };
  const runDelete = async () => {
    setDeleteError('');
    const stored = await getSessionSecret(accountId, accountId);
    let kp;
    try {
      kp = Keypair.fromSecret(stored || deleteInput.trim());
    } catch {
      setDeleteError(t('multisig:detail.unlock.invalid', 'Ungültiger Secret Key.'));
      return;
    }
    if (kp.publicKey() !== accountId) {
      setDeleteError(t('multisig:detail.unlock.wrongKey', { account: accountId, defaultValue: 'Dieser Secret Key gehört nicht zum geladenen Konto {{account}}.' }));
      return;
    }
    setDeleting(true);
    let deleted = 0;
    const failed = [];
    let stopped = 0;
    for (const [index, job] of selectedShown.entries()) {
      try {
        const { challenge } = await getMultisigJobChallenge(job.id, accountId);
        await deleteMultisigJob(job.id, accountId, signMultisigJobChallenge(kp.secret(), challenge, 'delete'));
        deleted += 1;
      } catch (e) {
        // Zu viele Anfragen: abbrechen statt jeden weiteren Job scheitern zu lassen.
        if (e?.status === 429) {
          stopped = selectedShown.length - index;
          break;
        }
        const reason = e?.status === 403
          ? t('multisig:list.deleteNotSigner', 'kein Signer')
          : e?.status === 503
            ? t('multisig:list.deleteHorizonUnavailable', 'Horizon nicht erreichbar')
          : e?.message === 'not_final'
            ? t('multisig:list.deleteNotFinal', 'nicht abgeschlossen')
            : String(e?.message || 'delete_failed');
        failed.push({ id: job.id, reason });
      }
    }
    setDeleting(false);
    setDeleteInput('');
    setDeletePanel(null);
    setSelected(new Set());
    setDeleteResult({ deleted, failed, stopped });
    await loadJobs();
  };

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

  const renderSignerBadges = (job) => {
    const collected = new Set((job?.collectedSigners || []).map((s) => s.publicKey));
    const declined = new Set((job?.declinedSigners || []).map((d) => d?.publicKey));
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
          const isDeclined = !signed && declined.has(pk);
          const short = shortPk(pk);
          const tone = signed
            ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
            : isDeclined
              ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100';
          return (
            <span
              key={pk || Math.random()}
              className={`px-2 py-0.5 rounded-sm text-xs ${tone}`}
              title={pk}
            >
              {short || t('multisig:list.signer.unknown', 'Signer')}
              {' '}
              {signed
                ? t('multisig:list.signer.signed', '✓')
                : isDeclined
                  ? t('multisig:list.signer.declined', 'abgelehnt')
                  : t('multisig:list.signer.missing', '…')}
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
            <button className={BTN} onClick={onBack}>{t('common:option.back', 'Zurück')}</button>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('multisig:list.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
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
                checked={includeSignerJobs || onlyPendingForMe}
                disabled={onlyPendingForMe}
                onChange={(e) => setIncludeSignerJobs(!!e.target.checked)}
              />
              {t('multisig:list.filter.assigned', 'Auch Aufträge, bei denen ich Signer bin')}
            </label>
          )}
          <button className={BTN} onClick={onBack}>{t('common:option.back', 'Zurück')}</button>
          <button className={BTN} onClick={loadJobs} disabled={loading}>{t('common:refresh', 'Refresh')}</button>
          <button className={BTN} onClick={handleExport} disabled={!jobsToShow || jobsToShow.length === 0 || loading}>
            {t('multisig:list.export', 'Exportieren')}
          </button>
          <button
            className={BTN_DANGER}
            onClick={() => { void openDeletePanel(); }}
            disabled={!selectedShown.length || loading || deleting}
          >
            {t('multisig:list.deleteSelected', { n: selectedShown.length, defaultValue: 'Auswahl löschen ({{n}})' })}
          </button>
        </div>
      </div>
      {hiddenCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(!!e.target.checked)} />
          {t('multisig:list.showHidden', { n: hiddenCount, defaultValue: 'Ausgeblendete anzeigen ({{n}})' })}
        </label>
      )}
      {deletePanel && (
        <form
          className="border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 rounded-sm p-3 space-y-2"
          data-testid="job-delete-panel"
          onSubmit={(e) => { e.preventDefault(); void deleteSelected(); }}
        >
          <div className="text-sm font-semibold">{t('multisig:list.deleteTitle', { n: selectedShown.length, defaultValue: '{{n}} abgeschlossene Jobs löschen' })}</div>
          <p className="text-xs text-gray-700 dark:text-gray-300">
            {t('multisig:list.deleteHint', { account: accountId, defaultValue: 'Gelöscht werden die Jobs für alle Signer. Erlaubt ist das nur für abgeschlossene Jobs (gesendet, fehlgeschlagen, abgelaufen, veraltet, abgelehnt). SKM meldet sich dafür je Job mit dem Secret Key von {{account}} an; der Key verlässt den Browser nicht.' })}
          </p>
          {deletePanel.needsKey && (
            <input
              type="password"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              aria-label={t('multisig:list.deleteKeyLabel', 'Secret Key zum Löschen')}
              className="w-full border-2 border-red-400 rounded-sm px-3 py-2 text-sm bg-white dark:bg-gray-800"
              placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
              autoComplete="off"
              spellCheck="false"
            />
          )}
          {deleteError && <div className="text-xs text-red-700 dark:text-red-300" role="alert">{deleteError}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 rounded-sm border text-sm" onClick={() => { setDeletePanel(null); setDeleteInput(''); }} disabled={deleting}>
              {t('common:option.cancel', 'Abbrechen')}
            </button>
            <button type="submit" className="px-3 py-1 rounded-sm bg-red-600 text-white text-sm disabled:opacity-50" disabled={deleting || (deletePanel.needsKey && !deleteInput.trim())}>
              {deleting ? t('common:common.loading') : t('multisig:list.deleteConfirm', 'Löschen')}
            </button>
          </div>
        </form>
      )}
      {deleteResult && (
        <div className="text-sm" role="status" data-testid="job-delete-result">
          {t('multisig:list.deleteDone', { n: deleteResult.deleted, defaultValue: '{{n}} Jobs gelöscht.' })}
          {deleteResult.stopped > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {' '}
              {t('multisig:list.deleteRateLimited', { n: deleteResult.stopped, defaultValue: 'Der Server hat zu viele Anfragen gemeldet. {{n}} Jobs wurden nicht mehr versucht, bitte in ein paar Minuten erneut löschen.' })}
            </span>
          )}
          {deleteResult.failed.length > 0 && (
            <span className="text-red-700 dark:text-red-300">
              {' '}
              {t('multisig:list.deleteFailed', {
                list: deleteResult.failed.map((f) => `${f.id.slice(0, 8)}… (${f.reason})`).join(', '),
                defaultValue: 'Nicht gelöscht: {{list}}',
              })}
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400" role="alert" data-testid="job-list-error">
          <div>{isNetworkError(error) ? t('multisig:list.loadFailedNetwork') : t('multisig:list.loadFailed')}</div>
          {error !== 'multisig.jobs.list_failed' && (
            <div className="text-xs opacity-80">{t('multisig:list.errorDetail', { detail: error })}</div>
          )}
        </div>
      )}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}
      {(!jobsToShow || jobsToShow.length === 0) && !loading && (
        <div className="text-sm text-gray-600">{t('multisig:list.empty')}</div>
      )}
      {jobsToShow && jobsToShow.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={!deletableShown.length}
                    onChange={toggleAll}
                    aria-label={t('multisig:list.selectAllFinal', 'Alle abgeschlossenen auswählen')}
                  />
                </th>
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
                <tr key={j.id} className={`border-b last:border-0 ${hiddenIds.has(j.id) ? 'opacity-60' : ''}`} data-testid="job-row">
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={selected.has(j.id)}
                      disabled={!isDeletable(j)}
                      onChange={() => toggleSelected(j.id)}
                      aria-label={t('multisig:list.select', { id: j.id, defaultValue: 'Job {{id}} auswählen' })}
                      title={isDeletable(j) ? '' : t('multisig:list.notDeletable', 'Nur abgeschlossene Jobs können gelöscht werden. Offene Jobs ablehnen oder widerrufen.')}
                    />
                  </td>
                  <td className="px-2 py-1 font-mono break-all">{j.accountId}</td>
                  <td className="px-2 py-1 font-mono break-all">{(j.txHash || '').slice(0, 12)}…</td>
                  <td className="px-2 py-1">
                    {DEAD_JOB_STATUSES.has(String(j.status || '')) ? (
                      <div>
                        <span className="font-semibold text-red-700 dark:text-red-300">{renderStatus(j.status)}</span>
                        <div className="text-xs text-red-700 dark:text-red-300" data-testid="job-dead-hint">{t('multisig:list.deadHint')}</div>
                      </div>
                    ) : renderStatus(j.status)}
                  </td>
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
                    <div className="flex flex-col items-end gap-1">
                    <button
                      className={FINAL_JOB_STATUSES.has(String(j.status || '')) ? BTN_ROW_SECONDARY : BTN_ROW_PRIMARY}
                      onClick={() => onOpenDetail(j.id, String(j.status || ''))}
                    >
                      {FINAL_JOB_STATUSES.has(String(j.status || ''))
                        ? t('multisig:list.detailsOnly', 'Details')
                        : t('multisig:list.details', 'Details anzeigen')}
                    </button>
                    <button
                      className={BTN_ROW_LINK}
                      onClick={() => toggleHidden(j.id)}
                    >
                      {hiddenIds.has(j.id) ? t('multisig:list.unhide', 'Einblenden') : t('multisig:list.hide', 'Ausblenden')}
                    </button>
                    </div>
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
