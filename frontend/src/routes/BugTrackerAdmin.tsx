import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type BugStatus = 'open' | 'in_progress' | 'closed';
type BugPriority = 'low' | 'normal' | 'high' | 'urgent';

interface BugReportRow {
  id: number;
  ts: string;
  url: string;
  userAgent: string;
  language: string;
  description: string | null;
  status: BugStatus;
  priority: BugPriority;
  appVersion: string | null;
}

interface UpdateDraft {
  status?: BugStatus;
  priority?: BugPriority;
}

const statusOptions: BugStatus[] = ['open', 'in_progress', 'closed'];
const priorityOptions: BugPriority[] = ['low', 'normal', 'high', 'urgent'];

const PAGE_SIZE = 20;

// Renders the hidden bug tracker admin panel.
const BugTrackerAdmin: React.FC = () => {
  const { t } = useTranslation();
  const [reports, setReports] = useState<BugReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | BugStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | BugPriority>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, UpdateDraft>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Determines if the current user is allowed to access the admin view.
  const isAuthorized = useMemo(() => {
    try {
      const secret = import.meta.env.VITE_BUGTRACKER_ADMIN_SECRET;
      if (!secret) return false;
      const token = window.localStorage?.getItem('BUGTRACKER_ADMIN_TOKEN');
      return token === secret;
    } catch {
      return false;
    }
  }, []);

  // Loads bug reports from the backend using current filters and pagination.
  const fetchReports = useCallback(async () => {
    if (!isAuthorized) return;
    setIsLoading(true);
    setNotice(null);
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    try {
      const res = await fetch(`/api/bugreport?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        throw new Error(`status_${res.status}`);
      }
      const data = await res.json();
      setReports(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (error) {
      console.error(error);
      setNotice(t('bugReport.admin.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthorized, page, priorityFilter, statusFilter, t]);

  // Sends a PATCH request to persist status/priority updates.
  const saveReport = useCallback(async (id: number) => {
    const draft = drafts[id];
    if (!draft) return;
    try {
      const res = await fetch(`/api/bugreport/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': import.meta.env.VITE_BUGTRACKER_ADMIN_SECRET ?? ''
        },
        body: JSON.stringify(draft)
      });
      if (!res.ok) {
        throw new Error(`status_${res.status}`);
      }
      setNotice(t('bugReport.admin.saved'));
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await fetchReports();
    } catch (error) {
      console.error(error);
      setNotice(t('bugReport.admin.saveError'));
    }
  }, [drafts, fetchReports, t]);

  // Applies a status change to local state and marks the report as dirty.
  const updateStatus = useCallback((id: number, value: BugStatus) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, status: value } : item)));
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], status: value } }));
  }, []);

  // Applies a priority change to local state and marks the report as dirty.
  const updatePriority = useCallback((id: number, value: BugPriority) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, priority: value } : item)));
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], priority: value } }));
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  if (!isAuthorized) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">{t('bugReport.admin.title')}</h1>
      {notice && (
        <div className="mb-4 text-sm bg-blue-100 dark:bg-blue-900/40 border border-blue-300 text-blue-800 dark:text-blue-100 rounded p-3">
          {notice}
        </div>
      )}
      <div className="flex flex-wrap gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">{t('bugReport.admin.status')}</label>
          <select
            value={statusFilter}
            onChange={(event) => { setPage(0); setStatusFilter(event.target.value as BugStatus | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('bugReport.admin.filter')}</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('bugReport.admin.priority')}</label>
          <select
            value={priorityFilter}
            onChange={(event) => { setPage(0); setPriorityFilter(event.target.value as BugPriority | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('bugReport.admin.filter')}</option>
            {priorityOptions.map((value) => (
              <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.id')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.created')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.url')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.language')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.userAgent')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.description')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.status')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.priority')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.save')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">{t('common.loading')}</td>
              </tr>
            )}
            {!isLoading && reports.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">{t('bugReport.admin.empty')}</td>
              </tr>
            )}
            {!isLoading && reports.map((report) => {
              const dirty = drafts[report.id] !== undefined;
              return (
                <tr key={report.id} className={dirty ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''}>
                  <td className="px-3 py-2">{report.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{report.ts}</td>
                  <td className="px-3 py-2 break-all">
                    <a href={report.url} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">{report.url}</a>
                    {report.appVersion && <div className="text-xs text-gray-500">v{report.appVersion}</div>}
                  </td>
                  <td className="px-3 py-2">{report.language}</td>
                  <td className="px-3 py-2 break-all">{report.userAgent}</td>
                  <td className="px-3 py-2 whitespace-pre-wrap break-words">{report.description || '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      value={report.status}
                      onChange={(event) => updateStatus(report.id, event.target.value as BugStatus)}
                      className="border rounded px-2 py-1"
                    >
                      {statusOptions.map((value) => (
                        <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={report.priority}
                      onChange={(event) => updatePriority(report.id, event.target.value as BugPriority)}
                      className="border rounded px-2 py-1"
                    >
                      {priorityOptions.map((value) => (
                        <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => saveReport(report.id)}
                      disabled={!dirty}
                      className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-40"
                    >
                      {t('bugReport.admin.save')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-4">
        <button
          type="button"
          onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          className="px-3 py-1 border rounded disabled:opacity-40"
          disabled={page === 0}
        >
          ‹
        </button>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {page + 1} / {totalPages}
        </div>
        <button
          type="button"
          onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
          className="px-3 py-1 border rounded disabled:opacity-40"
          disabled={page >= totalPages - 1}
        >
          ›
        </button>
      </div>
    </div>
  );
};

export default BugTrackerAdmin;
