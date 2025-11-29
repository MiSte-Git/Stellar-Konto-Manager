import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl } from '../utils/apiBase.js';

type BugStatus = 'open' | 'in_progress' | 'closed';
type BugPriority = 'low' | 'normal' | 'high' | 'urgent';
type BugCategory = 'bug' | 'idea' | 'improve' | 'other';
type BugPage = 'start' | 'trustlines' | 'trustlineCompare' | 'balance' | 'xlmByMemo' | 'sendPayment' | 'investedTokens' | 'createAccount' | 'multisigEdit' | 'settings' | 'feedback' | 'other';

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
  page: BugPage;
  appVersion: string | null;
}

interface UpdateDraft {
  status?: BugStatus;
  priority?: BugPriority;
  category?: BugCategory;
  page?: BugPage;
}

const statusOptions: BugStatus[] = ['open', 'in_progress', 'closed'];
const priorityOptions: BugPriority[] = ['low', 'normal', 'high', 'urgent'];
const categoryOptions: BugCategory[] = ['bug', 'idea', 'improve', 'other'];
const pageOptions: BugPage[] = ['start','trustlines','trustlineCompare','balance','xlmByMemo','sendPayment','investedTokens','createAccount','multisigEdit','settings','feedback','other'];

const PAGE_SIZE = 20;

// Column keys available for configuration (excluding the action column)
const ALL_COLUMN_KEYS = [
  'id',
  'ts',
  'url',
  'page',
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
  order: ['id', 'ts', 'url', 'page', 'language', 'email', 'userAgent', 'description', 'category', 'status', 'priority', 'appVersion'],
  visible: {
    id: true,
    ts: true,
    url: true,
    page: true,
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
    page: 160,
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
  const { t, i18n } = useTranslation(['common']);
  const [reports, setReports] = useState<BugReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | BugStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | BugPriority>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | BugCategory>('all');
  const [pageFilter, setPageFilter] = useState<'all' | BugPage>('all');
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
  const [secretInput, setSecretInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [csvDelimiter, setCsvDelimiter] = useState<string>(',');

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
    if (pageFilter !== 'all') params.set('page', pageFilter);
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
      setNotice(t('common:bugReport.admin.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthorized, page, priorityFilter, statusFilter, categoryFilter, pageFilter, search, sortKey, sortDir, t]);

  // Sends a PATCH request to persist updates. Optionally accepts an override draft for immediate save.
  const saveReport = useCallback(async (id: number, override?: UpdateDraft) => {
    const draft = override ?? drafts[id];
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
      setNotice(t('common:bugReport.admin.saved'));
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await fetchReports();
    } catch (error) {
      console.error(error);
      setNotice(t('common:bugReport.admin.saveError'));
    }
  }, [drafts, fetchReports, t]);

  // Applies a status change and autosaves.
  const updateStatus = useCallback((id: number, value: BugStatus) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, status: value } : item)));
    setDrafts((prev) => {
      const merged = { ...prev[id], status: value } as UpdateDraft;
      saveReport(id, merged);
      return { ...prev, [id]: merged };
    });
  }, [saveReport]);

  // Applies a priority change and autosaves.
  const updatePriority = useCallback((id: number, value: BugPriority) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, priority: value } : item)));
    setDrafts((prev) => {
      const merged = { ...prev[id], priority: value } as UpdateDraft;
      saveReport(id, merged);
      return { ...prev, [id]: merged };
    });
  }, [saveReport]);

  // Applies a category change and autosaves.
  const updateCategory = useCallback((id: number, value: BugCategory) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, category: value } : item)));
    setDrafts((prev) => {
      const merged = { ...prev[id], category: value } as UpdateDraft;
      saveReport(id, merged);
      return { ...prev, [id]: merged };
    });
  }, [saveReport]);

  // Applies a page change and autosaves.
  const updatePage = useCallback((id: number, value: BugPage) => {
    setReports((prev) => prev.map((item) => (item.id === id ? { ...item, page: value } : item)));
    setDrafts((prev) => {
      const merged = { ...prev[id], page: value } as UpdateDraft;
      saveReport(id, merged);
      return { ...prev, [id]: merged };
    });
  }, [saveReport]);

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
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold mb-2">{t('common:bugReport.admin.title', 'Bugtracker')}</h1>
        <p className="text-sm mb-4">{t('common:bugReport.admin.locked', 'Zugriff verweigert. Setze das Admin-Secret im lokalen Speicher und lade die Seite neu.')}</p>
        <div className="space-y-2">
          <label className="block text-xs mb-1">{t('common:bugReport.admin.enterSecret', 'Admin-Secret eingeben')}</label>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder={t('common:bugReport.admin.secretPlaceholder', '••••••••')}
            className="w-full border rounded px-2 py-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => {
                try {
                  const val = String(secretInput || '').trim();
                  if (!val) return;
                  window.localStorage?.setItem('BUGTRACKER_ADMIN_TOKEN', val);
                  window.location.reload();
                } catch (err) {
                  console.error('bugReport.admin.navigate.failed', err);
                }
              }}
              title={t('common:bugReport.admin.confirm', 'Öffnen')}
            >
              {t('common:bugReport.admin.confirm', 'Öffnen')}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => { try { window.history.back(); } catch {} }}
              title={t('common:bugReport.admin.cancel', 'Abbrechen')}
            >
              {t('common:bugReport.admin.cancel', 'Abbrechen')}
            </button>
          </div>
        </div>
        <pre className="bg-gray-100 dark:bg-gray-900 rounded p-3 text-xs overflow-auto mt-4">{`// Secret im Browser setzen und Seite neu laden:
localStorage.setItem('BUGTRACKER_ADMIN_TOKEN', '<DEIN-SECRET>');
// Aufrufen:
window.location.assign(window.location.pathname);`}</pre>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const visibleColumns = prefs.order.filter((k) => prefs.visible[k]);

  const processedReports = useMemo(() => {
    let items = reports.slice();
    const q = search.trim().toLowerCase();
    const labelForPage = (p?: string) => t(`feedback.pages.${p || 'other'}`, t('common:feedback.pages.other', 'Sonstiges')).toLowerCase();
    if (q) {
      items = items.filter((r) => {
        const desc = stripCategoryHeader(r.description);
        const email = r.contactEmail || (r as any).email || extractEmail(desc) || '';
        const pageLabel = labelForPage(r.page);
        const fields = [
          String(r.id), r.ts, r.url, r.language, r.userAgent, desc, r.category, r.status, r.priority, r.appVersion || '', email, r.page, pageLabel
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
                   key === 'page' ? labelForPage(a.page) :
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
                   key === 'page' ? labelForPage(b.page) :
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
  }, [reports, search, sortKey, sortDir, t]);

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

  const acronym = (s: string) => s.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
  const appShort = (import.meta.env.VITE_APP_SHORTNAME && String(import.meta.env.VITE_APP_SHORTNAME).trim()) || acronym(t('common:main.title', 'Stellar Konto Manager'));

  const labelForColumn = useCallback((key: ColumnKey) => (
    key === 'id' ? t('common:bugReport.admin.id') :
    key === 'ts' ? t('common:bugReport.admin.created') :
    key === 'url' ? t('common:bugReport.admin.url') :
    key === 'page' ? t('common:feedback.page', 'Bereich') :
    key === 'language' ? t('common:bugReport.admin.language') :
    key === 'email' ? t('common:bugReport.admin.email', 'E‑Mail') :
    key === 'userAgent' ? t('common:bugReport.admin.userAgent') :
    key === 'description' ? t('common:bugReport.admin.description') :
    key === 'category' ? t('common:bugReport.admin.category') :
    key === 'status' ? t('common:bugReport.admin.status') :
    key === 'priority' ? t('common:bugReport.admin.priority') :
    key === 'appVersion' ? 'Version' : String(key)
  ), [t]);

  const getCellString = useCallback((report: BugReportRow, key: ColumnKey) => {
    switch (key) {
      case 'id': return String(report.id);
      case 'ts': return formatDate(report.ts, i18n?.language);
      case 'url': return report.url;
      case 'page': return t(`feedback.pages.${report.page || 'other'}`, t('common:feedback.pages.other', 'Sonstiges'));
      case 'language': return report.language;
      case 'userAgent': return report.userAgent;
      case 'email': {
        const email = report.contactEmail || (report as any).email || extractEmail(stripCategoryHeader(report.description)) || '';
        return email;
      }
      case 'description': {
        const raw = report.description || '';
        const parts = raw.split(/\r?\n/);
        const stripped = parts[0]?.trim().toLowerCase().startsWith('kategorie:') ? parts.slice(1).join('\n').trim() : raw.trim();
        return stripped;
      }
      case 'category': return t(`feedback.categories.${report.category}`);
      case 'status': return t(`bugReport.admin.${report.status}`);
      case 'priority': return t(`bugReport.admin.${report.priority}`);
      case 'appVersion': return report.appVersion ? `v${report.appVersion}` : '';
      default: return '';
    }
  }, [i18n?.language, t]);

  const csvEscape = (v: string, delimiter: string) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes('\n') || s.includes(delimiter)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const buildCsvAndDownload = (items: BugReportRow[], suffix: string, delimiter: string) => {
    const headers = visibleColumns.map((k) => labelForColumn(k));
    const rows = items.map((r) => visibleColumns.map((k) => getCellString(r, k)));
    const lines = [headers, ...rows].map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter));
    const csv = lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `${appShort}-bugreports-${suffix}-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportCurrentPageCsv = () => {
    try {
      buildCsvAndDownload(processedReports, 'page', csvDelimiter);
    } catch (e) {
      console.error(e);
      setNotice(t('common:bugReport.admin.exportError', 'Export fehlgeschlagen'));
    }
  };

  const exportAllCsv = async () => {
    setIsExporting(true);
    setNotice(t('common:bugReport.admin.exporting', 'Exportiere…'));
    try {
      const limit = 500;
      let offset = 0;
      const all: BugReportRow[] = [];
      // Build base params with current filters/search/sort
      const base = new URLSearchParams();
      if (statusFilter !== 'all') base.set('status', statusFilter);
      if (priorityFilter !== 'all') base.set('priority', priorityFilter);
      if (categoryFilter !== 'all') base.set('category', categoryFilter);
      if (pageFilter !== 'all') base.set('page', pageFilter);
      if (search.trim()) base.set('q', search.trim());
      if (sortKey) { base.set('sort', sortKey); base.set('dir', sortDir); }
      while (true) {
        const params = new URLSearchParams(base);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        const res = await fetch(`${apiUrl('bugreport')}?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`status_${res.status}`);
        const data = await res.json();
        const items: BugReportRow[] = Array.isArray(data.items) ? data.items : [];
        all.push(...items);
        if (items.length < limit) break;
        offset += limit;
      }
      buildCsvAndDownload(all, 'all', csvDelimiter);
      setNotice(null);
    } catch (e) {
      console.error(e);
      setNotice(t('common:bugReport.admin.exportError', 'Export fehlgeschlagen'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => { try { window.history.back(); } catch {} }}
            title={t('common:back', 'Zurück')}
          >
            {t('common:back', 'Zurück')}
          </button>
          <h1 className="text-2xl font-semibold">{t('common:bugReport.admin.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            placeholder={t('common:bugReport.admin.search', 'Suche')}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="border rounded px-2 py-1"
          />
          <button
            type="button"
            className="px-3 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setShowColumnManager(true)}
            title={t('common:bugReport.admin.columns.title', 'Spalten')}
          >
            {t('common:bugReport.admin.columns.title', 'Spalten')}
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
            <span>{t('common:bugReport.admin.csv.delimiter', 'Trennzeichen')}</span>
            <select
              value={csvDelimiter}
              onChange={(e) => setCsvDelimiter(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
              title={t('common:bugReport.admin.csv.delimiter', 'Trennzeichen')}
            >
              <option value=",">{t('common:bugReport.admin.csv.comma', 'Komma (,)')}</option>
              <option value=";">{t('common:bugReport.admin.csv.semicolon', 'Semikolon (;)')}</option>
              <option value="\t">{t('common:bugReport.admin.csv.tab', 'Tabulator (Tab)')}</option>
            </select>
          </label>
          <button
            type="button"
            className="px-3 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
            onClick={exportCurrentPageCsv}
            disabled={isExporting || isLoading || processedReports.length === 0}
            title={t('common:bugReport.admin.exportPage', 'CSV (Seite)')}
          >
            {t('common:bugReport.admin.exportPage', 'CSV (Seite)')}
          </button>
          <button
            type="button"
            className="px-3 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
            onClick={exportAllCsv}
            disabled={isExporting}
            title={t('common:bugReport.admin.exportAll', 'CSV (Alle)')}
          >
            {isExporting ? t('common:bugReport.admin.exporting', 'Exportiere…') : t('common:bugReport.admin.exportAll', 'CSV (Alle)')}
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
          <label className="block text-sm font-medium mb-1">{t('common:bugReport.admin.status')}</label>
          <select
            value={statusFilter}
            onChange={(event) => { setPage(0); setStatusFilter(event.target.value as BugStatus | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('common:bugReport.admin.filter')}</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common:bugReport.admin.priority')}</label>
          <select
            value={priorityFilter}
            onChange={(event) => { setPage(0); setPriorityFilter(event.target.value as BugPriority | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('common:bugReport.admin.filter')}</option>
            {priorityOptions.map((value) => (
              <option key={value} value={value}>{t(`bugReport.admin.${value}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common:bugReport.admin.category')}</label>
          <select
            value={categoryFilter}
            onChange={(event) => { setPage(0); setCategoryFilter(event.target.value as BugCategory | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('common:bugReport.admin.filter')}</option>
            {categoryOptions.map((value) => (
              <option key={value} value={value}>{t(`feedback.categories.${value}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t('common:feedback.page', 'Bereich')}</label>
          <select
            value={pageFilter}
            onChange={(event) => { setPage(0); setPageFilter(event.target.value as BugPage | 'all'); }}
            className="border rounded px-3 py-2"
          >
            <option value="all">{t('common:bugReport.admin.filter')}</option>
            {pageOptions.map((value) => (
              <option key={value} value={value}>{t(`feedback.pages.${value}`, value)}</option>
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
                  key === 'id' ? t('common:bugReport.admin.id') :
                  key === 'ts' ? t('common:bugReport.admin.created') :
                  key === 'url' ? t('common:bugReport.admin.url') :
                  key === 'page' ? t('common:feedback.page', 'Bereich') :
                  key === 'language' ? t('common:bugReport.admin.language') :
                  key === 'email' ? t('common:bugReport.admin.email', 'E‑Mail') :
                  key === 'userAgent' ? t('common:bugReport.admin.userAgent') :
                  key === 'description' ? t('common:bugReport.admin.description') :
                  key === 'category' ? t('common:bugReport.admin.category') :
                  key === 'status' ? t('common:bugReport.admin.status') :
                  key === 'priority' ? t('common:bugReport.admin.priority') :
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
                      title={t('common:bugReport.admin.resize', 'Ziehen zum Anpassen')}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
            {isLoading && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-6 text-center text-gray-500">{t('common:common.loading')}</td>
              </tr>
            )}
            {!isLoading && processedReports.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-6 text-center text-gray-500">{t('common:bugReport.admin.empty')}</td>
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
                      case 'page': content = (
                        <select
                          value={report.page}
                          onChange={(event) => updatePage(report.id, event.target.value as BugPage)}
                          className="border rounded px-2 py-1"
                        >
                          {pageOptions.map((value) => (
                            <option key={value} value={value}>{t(`feedback.pages.${value}`, value)}</option>
                          ))}
                        </select>
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
                      case 'category': content = (
                        <select
                          value={report.category}
                          onChange={(event) => updateCategory(report.id, event.target.value as BugCategory)}
                          className="border rounded px-2 py-1"
                        >
                          {categoryOptions.map((value) => (
                            <option key={value} value={value}>{t(`feedback.categories.${value}`)}</option>
                          ))}
                        </select>
                      ); break;
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
              <h2 className="text-base font-semibold">{t('common:bugReport.admin.columns.manage', 'Spalten anpassen')}</h2>
              <button className="px-2 py-1 border rounded" onClick={() => setShowColumnManager(false)}>{t('common:common.close', 'Schließen')}</button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('common:bugReport.admin.columns.hint', 'Sichtbarkeit per Haken, Reihenfolge mit ↑/↓, Größen durch Ziehen im Tabellenkopf.')}</p>
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
                    {key === 'id' ? t('common:bugReport.admin.id') :
                     key === 'ts' ? t('common:bugReport.admin.created') :
                     key === 'url' ? t('common:bugReport.admin.url') :
                     key === 'page' ? t('common:feedback.page', 'Bereich') :
                     key === 'language' ? t('common:bugReport.admin.language') :
                     key === 'email' ? t('common:bugReport.admin.email', 'E‑Mail') :
                     key === 'userAgent' ? t('common:bugReport.admin.userAgent') :
                     key === 'description' ? t('common:bugReport.admin.description') :
                     key === 'category' ? t('common:bugReport.admin.category') :
                     key === 'status' ? t('common:bugReport.admin.status') :
                     key === 'priority' ? t('common:bugReport.admin.priority') :
                     key === 'appVersion' ? 'Version' : key}
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="px-2 py-1 border rounded" onClick={() => moveColumn(key, -1)} title={t('common:bugReport.admin.columns.up', 'Nach oben')}>↑</button>
                    <button className="px-2 py-1 border rounded" onClick={() => moveColumn(key, 1)} title={t('common:bugReport.admin.columns.down', 'Nach unten')}>↓</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4">
              <button className="px-3 py-2 border rounded" onClick={resetColumns}>{t('common:bugReport.admin.columns.reset', 'Zurücksetzen')}</button>
              <button className="px-3 py-2 border rounded" onClick={() => setShowColumnManager(false)}>{t('common:common.close', 'Schließen')}</button>
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
