import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl } from '../utils/apiBase.js';

type BugStatus = 'open' | 'in_progress' | 'closed';
type BugPriority = 'low' | 'normal' | 'high' | 'urgent';
type BugCategory = 'bug' | 'idea' | 'improve' | 'other';

interface BugReportRow {
  id: number;
  ts: string;
  url: string;
  userAgent: string;
  language: string;
  contactEmail: string | null;
  description: string | null;
  status: BugStatus;
  priority: BugPriority;
  category: BugCategory;
  appVersion: string | null;
}

interface UpdateDraft {
  status?: BugStatus;
  priority?: BugPriority;
}

const statusOptions: BugStatus[] = ['open', 'in_progress', 'closed'];
const priorityOptions: BugPriority[] = ['low', 'normal', 'high', 'urgent'];
const categoryOptions: BugCategory[] = ['bug', 'idea', 'improve', 'other'];

const PAGE_SIZE = 20;

// Column keys available for configuration (excluding the action column)
const ALL_COLUMN_KEYS = [
  'id',
  'ts',
  'url',
  'language',
  'email',
  'userAgent',
  'description',
  'category',
  'status',
  'priority',
  'appVersion',
] as const;

type ColumnKey = typeof ALL_COLUMN_KEYS[number];

type ColumnPrefs = {
  order: ColumnKey[];
  visible: Record<ColumnKey, boolean>;
  widths: Record<ColumnKey, number | undefined>;
};

const DEFAULT_PREFS: ColumnPrefs = {
  order: ['id', 'ts', 'url', 'language', 'email', 'userAgent', 'description', 'category', 'status', 'priority', 'appVersion'],
  visible: {
    id: true,
    ts: true,
    url: true,
    language: true,
    email: true,
    userAgent: false,
    description: true,
    category: true,
    status: true,
    priority: true,
    appVersion: false,
  },
  widths: {
    id: 70,
    ts: 160,
    url: 320,
    language: 100,
    email: 200,
    userAgent: 280,
    description: 260,
    category: 120,
    status: 140,
    priority: 120,
    appVersion: 110,
  },
};

const STORAGE_KEY = 'BUGTRACKER_COLUMNS_PREFS';

function loadPrefs(): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k: string) => (ALL_COLUMN_KEYS as any).includes(k)) : DEFAULT_PREFS.order;
    const visible = { ...DEFAULT_PREFS.visible, ...(parsed.visible || {}) } as ColumnPrefs['visible'];
    const widths = { ...DEFAULT_PREFS.widths, ...(parsed.widths || {}) } as ColumnPrefs['widths'];
    const missing = (ALL_COLUMN_KEYS as readonly string[]).filter((k) => !order.includes(k as ColumnKey));
    const cleanedOrder = [...order, ...missing] as ColumnKey[];
    return { order: cleanedOrder, visible, widths };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: ColumnPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

function formatDate(value: string, locale?: string) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const loc = locale || (typeof navigator !== 'undefined' ? navigator.language : 'de-DE');
    return new Intl.DateTimeFormat(loc, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
  } catch {
    return value;
  }
}

function stripCategoryHeader(desc: string | null | undefined): string {
  const raw = String(desc || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\r?\n/);
  if (parts[0]?.trim().toLowerCase().startsWith('kategorie:')) {
    return parts.slice(1).join('\n').trim();
  }
  return raw;
}

function extractEmail(text: string | null | undefined): string | null {
  const raw = String(text || '');
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

// Renders the hidden bug tracker admin panel.
const BugTrackerAdmin: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [reports, setReports] = useState<BugReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | BugStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | BugPriority>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | BugCategory>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, UpdateDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => (typeof window !== 'undefined' ? loadPrefs() : DEFAULT_PREFS));
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [resizing, setResizing] = useState<{ key: ColumnKey; startX: number; startW: number } | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    try {
      if (search.trim()) params.set('q', search.trim());
      if (sortKey) { params.set('sort', sortKey); params.set('dir', sortDir); }
      const res = await fetch(`${apiUrl('bugreport')}?${params.toString()}`, {
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
  }, [isAuthorized, page, priorityFilter, statusFilter, categoryFilter, search, sortKey, sortDir, t]);

  // Sends a PATCH request to persist status/priority updates.
  const saveReport = useCallback(async (id: number) => {
    const draft = drafts[id];
    if (!draft) return;
    try {
      const res = await fetch(apiUrl(`bugreport/${id}`), {
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

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizing.startX;
      const newW = Math.max(60, Math.min(1000, Math.round(resizing.startW + dx)));
      setPrefs((p) => ({ ...p, widths: { ...p.widths, [resizing.key]: newW } }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  if (!isAuthorized) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const visibleColumns = prefs.order.filter((k) => prefs.visible[k]);

  const processedReports = useMemo(() => {
    let items = reports.slice();
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((r) => {
        const desc = stripCategoryHeader(r.description);
        const email = r.contactEmail || (r as any).email || extractEmail(desc) || '';
        const fields = [
          String(r.id), r.ts, r.url, r.language, r.userAgent, desc, r.category, r.status, r.priority, r.appVersion || '', email
        ].map((s) => String(s || '').toLowerCase());
        return fields.some((s) => s.includes(q));
      });
    }
    if (sortKey) {
      const key = sortKey;
      items.sort((a, b) => {
        const va = key === 'description' ? stripCategoryHeader(a.description) :
                   key === 'email' ? (a.contactEmail || (a as any).email || extractEmail(stripCategoryHeader(a.description)) || '') :
                   key === 'appVersion' ? (a.appVersion || '') :
                   key === 'ts' ? a.ts :
                   key === 'url' ? a.url :
                   key === 'language' ? a.language :
                   key === 'userAgent' ? a.userAgent :
                   key === 'category' ? a.category :
                   key === 'status' ? a.status :
                   key === 'priority' ? a.priority :
                   key === 'id' ? a.id : '' as any;
        const vb = key === 'description' ? stripCategoryHeader(b.description) :
                   key === 'email' ? (b.contactEmail || (b as any).email || extractEmail(stripCategoryHeader(b.description)) || '') :
                   key === 'appVersion' ? (b.appVersion || '') :
                   key === 'ts' ? b.ts :
                   key === 'url' ? b.url :
                   key === 'language' ? b.language :
                   key === 'userAgent' ? b.userAgent :
                   key === 'category' ? b.category :
                   key === 'status' ? b.status :
                   key === 'priority' ? b.priority :
                   key === 'id' ? b.id : '' as any;
        let cmp = 0;
        if (key === 'id') {
          cmp = (va as number) - (vb as number);
        } else if (key === 'ts') {
          cmp = new Date(va as string).getTime() - new Date(vb as string).getTime();
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return items;
  }, [reports, search, sortKey, sortDir]);

  const moveColumn = (key: ColumnKey, dir: -1 | 1) => {
    setPrefs((p) => {
      const idx = p.order.indexOf(key);
      if (idx < 0) return p;
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= p.order.length) return p;
      const next = [...p.order];
      const tmp = next[idx];
      next[idx] = next[swapIdx];
      next[swapIdx] = tmp;
      return { ...p, order: next };
    });
  };

  const resetColumns = () => setPrefs(DEFAULT_PREFS);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{t('bugReport.admin.title')}</h1>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            placeholder={t('bugReport.admin.search', 'Suche')}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="border rounded px-2 py-1"
          />
          <button
            type="button"
            className="px-3 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setShowColumnManager(true)}
            title={t('bugReport.admin.columns.title', 'Spalten')}
          >
            {t('bugReport.admin.columns.title', 'Spalten')}
          </button>
        </div>
      </div>
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
        <div>
          <label className="block text-sm font-medium mb-1">{t('bugReport.admin.category')}</label>
          <select
            value={categoryFilter}
            onChange={(event) => { setPage(0); setCategoryFilter(event.target.value as BugCategory | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('bugReport.admin.filter')}</option>
            {categoryOptions.map((value) => (
              <option key={value} value={value}>{t(`feedback.categories.${value}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {visibleColumns.map((key) => {
                const width = prefs.widths[key];
                const common = 'px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200 relative';
                const style = width ? { width: `${width}px`, minWidth: `${width}px` } as React.CSSProperties : undefined;
                const label = (
                  key === 'id' ? t('bugReport.admin.id') :
                  key === 'ts' ? t('bugReport.admin.created') :
                  key === 'url' ? t('bugReport.admin.url') :
                  key === 'language' ? t('bugReport.admin.language') :
                  key === 'email' ? t('bugReport.admin.email', 'E‑Mail') :
                  key === 'userAgent' ? t('bugReport.admin.userAgent') :
                  key === 'description' ? t('bugReport.admin.description') :
                  key === 'category' ? t('bugReport.admin.category') :
                  key === 'status' ? t('bugReport.admin.status') :
                  key === 'priority' ? t('bugReport.admin.priority') :
                  key === 'appVersion' ? 'Version' : key
                );
                const arrow = sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                return (
                  <th
                    key={key}
                    className={common + ' hover:bg-gray-100/40 dark:hover:bg-gray-800/40 cursor-pointer select-none'}
                    style={style}
                    onClick={() => {
                      if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
                      else { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
                    }}
                  >
                    {label}{arrow}
                    <div
                      className="absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                      onMouseDown={(e) => {
                        const startX = e.clientX;
                        const startW = (prefs.widths[key] || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 140));
                        setResizing({ key, startX, startW });
                      }}
                      title={t('bugReport.admin.resize', 'Ziehen zum Anpassen')}
                    />
                  </th>
                );
              })}
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200">{t('bugReport.admin.save')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
            {isLoading && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-6 text-center text-gray-500">{t('common.loading')}</td>
              </tr>
            )}
            {!isLoading && processedReports.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-6 text-center text-gray-500">{t('bugReport.admin.empty')}</td>
              </tr>
            )}
            {!isLoading && processedReports.map((report) => {
              const dirty = drafts[report.id] !== undefined;
              return (
                <tr key={report.id} className={dirty ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''}>
                  {visibleColumns.map((key) => {
                    const width = prefs.widths[key];
                    const style = width ? { width: `${width}px`, minWidth: `${width}px` } as React.CSSProperties : undefined;
                    let content: React.ReactNode = null;
                    switch (key) {
                      case 'id': content = report.id; break;
                      case 'ts': content = formatDate(report.ts, i18n?.language); break;
                      case 'url': content = (
                        <div className="break-all">
                          <a href={report.url} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">{report.url}</a>
                          {report.appVersion && <div className="text-xs text-gray-500">v{report.appVersion}</div>}
                        </div>
                      ); break;
                      case 'language': content = report.language; break;
                      case 'userAgent': content = <span className="break-all">{report.userAgent}</span>; break;
                      case 'email': {
                        const email = report.contactEmail || (report as any).email || extractEmail(stripCategoryHeader(report.description)) || null;
                        content = <span className="break-all">{email || '—'}</span>;
                      } break;
                      case 'description': {
                        const raw = report.description || '';
                        const parts = raw.split(/\r?\n/);
                        const stripped = parts[0]?.trim().toLowerCase().startsWith('kategorie:') ? parts.slice(1).join('\n').trim() : raw.trim();
                        content = <span className="whitespace-pre-wrap break-words">{stripped || '—'}</span>;
                      } break;
                      case 'category': content = t(`feedback.categories.${report.category}`); break;
                      case 'status': content = (
                        <select
                          value={report.status}
                          onChange={(event) => updateStatus(report.id, event.target.value as BugStatus)}
                          className="border rounded px-2 py-1"
                        >
                          {statusOptions.map((value) => (
                            <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
                          ))}
                        </select>
                      ); break;
                      case 'priority': content = (
                        <select
                          value={report.priority}
                          onChange={(event) => updatePriority(report.id, event.target.value as BugPriority)}
                          className="border rounded px-2 py-1"
                        >
                          {priorityOptions.map((value) => (
                            <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
                          ))}
                        </select>
                      ); break;
                      case 'appVersion': content = report.appVersion ? `v${report.appVersion}` : '—'; break;
                      default: content = null;
                    }
                    return (
                      <td key={key} className="px-3 py-2 align-top" style={style}>{content}</td>
                    );
                  })}
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

      {showColumnManager && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowColumnManager(false)} aria-hidden />
          <div className="relative max-h-[90vh] w-[min(92vw,560px)] overflow-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">{t('bugReport.admin.columns.manage', 'Spalten anpassen')}</h2>
              <button className="px-2 py-1 border rounded" onClick={() => setShowColumnManager(false)}>{t('common.close', 'Schließen')}</button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('bugReport.admin.columns.hint', 'Sichtbarkeit per Haken, Reihenfolge mit ↑/↓, Größen durch Ziehen im Tabellenkopf.')}</p>
            <div className="space-y-2">
              {prefs.order.map((key) => (
                <div key={key} className="flex items-center gap-2 border rounded p-2">
                  <input
                    type="checkbox"
                    checked={!!prefs.visible[key]}
                    onChange={(e) => setPrefs((p) => ({ ...p, visible: { ...p.visible, [key]: e.target.checked } }))}
                    aria-label={String(key)}
                  />
                  <div className="flex-1 text-sm">
                    {key === 'id' ? t('bugReport.admin.id') :
                     key === 'ts' ? t('bugReport.admin.created') :
                     key === 'url' ? t('bugReport.admin.url') :
                     key === 'language' ? t('bugReport.admin.language') :
                     key === 'email' ? t('bugReport.admin.email', 'E‑Mail') :
                     key === 'userAgent' ? t('bugReport.admin.userAgent') :
                     key === 'description' ? t('bugReport.admin.description') :
                     key === 'category' ? t('bugReport.admin.category') :
                     key === 'status' ? t('bugReport.admin.status') :
                     key === 'priority' ? t('bugReport.admin.priority') :
                     key === 'appVersion' ? 'Version' : key}
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="px-2 py-1 border rounded" onClick={() => moveColumn(key, -1)} title={t('bugReport.admin.columns.up', 'Nach oben')}>↑</button>
                    <button className="px-2 py-1 border rounded" onClick={() => moveColumn(key, 1)} title={t('bugReport.admin.columns.down', 'Nach unten')}>↓</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4">
              <button className="px-3 py-2 border rounded" onClick={resetColumns}>{t('bugReport.admin.columns.reset', 'Zurücksetzen')}</button>
              <button className="px-3 py-2 border rounded" onClick={() => setShowColumnManager(false)}>{t('common.close', 'Schließen')}</button>
            </div>
          </div>
        </div>
      )}
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

