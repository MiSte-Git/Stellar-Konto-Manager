import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BugTrackerAdmin: Minimal-Admin-UI (Platzhalter).
 * Prüft Secret in localStorage gegen VITE_BUGTRACKER_ADMIN_SECRET.
 * In diesem Patch werden Reports vom Backend gelesen (/api/bugreport)
 * und tabellarisch angezeigt.
 */
export default function BugTrackerAdmin() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [items, setItems] = useState([]);

  // checkAccess: Vergleicht lokales Token mit dem Build-Secret.
  const ok = useMemo(() => {
    try {
      const token = localStorage.getItem('BUGTRACKER_ADMIN_TOKEN') || '';
      const secret = import.meta.env.VITE_BUGTRACKER_ADMIN_SECRET || '';
      return Boolean(token) && token === secret;
    } catch (e) {
      // UI-Komponente fängt den Fehler ab und übersetzt ihn mit t()
      throw new Error('bugReport.admin.check.failed:' + (e?.message || 'unknown'));
    }
  }, []);

  // loadReports: Holt die vorhandenen Bugreports vom Backend.
  async function loadReports() {
    try {
      setLoading(true);
      setErrorKey('');
      const res = await fetch('/api/bugreport', { method: 'GET' });
      if (!res.ok) {
        throw new Error('bugReport.admin.loadFailed:' + res.status);
      }
      const data = await res.json();
      if (!data?.ok || !Array.isArray(data.items)) {
        throw new Error('bugReport.admin.invalidResponse');
      }
      setItems(data.items);
    } catch (err) {
      console.warn('bugReport.admin.loadFailed', err);
      // UI zeigt t(errorKey)
      setErrorKey('bugReport.admin.loadError');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setReady(true);
    if (ok) {
      loadReports();
    }
  }, [ok]);

  if (!ready) return null;

  if (!ok) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold mb-2">{t('bugReport.admin.title')}</h1>
        <p className="text-sm mb-4">{t('bugReport.admin.locked')}</p>
        <pre className="bg-gray-100 dark:bg-gray-900 rounded p-3 text-xs overflow-auto">
{`// Secret im Browser setzen und Seite neu laden:
localStorage.setItem('BUGTRACKER_ADMIN_TOKEN', '<DEIN-SECRET>');
// Aufrufen:
window.location.assign('/bugtracker');`}
        </pre>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold mb-2">{t('bugReport.admin.placeholderTitle')}</h1>
      <p className="text-sm mb-4">{t('bugReport.admin.placeholderBody')}</p>

      {errorKey && (
        <div
          className="mb-4 rounded border border-red-600 text-red-600 text-xs p-2"
          data-confirm-toast="true"
        >
          {t(errorKey)}
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-100 dark:bg-gray-800 text-left">
            <tr>
              <th className="px-2 py-1">{t('bugReport.admin.col.id', 'ID')}</th>
              <th className="px-2 py-1">{t('bugReport.admin.col.status', 'Status')}</th>
              <th className="px-2 py-1">{t('bugReport.admin.col.priority', 'Priority')}</th>
              <th className="px-2 py-1">{t('bugReport.admin.col.url', 'URL')}</th>
              <th className="px-2 py-1">{t('bugReport.admin.col.desc', 'Description')}</th>
              <th className="px-2 py-1">{t('bugReport.admin.col.ts', 'Time')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-2 py-2 text-gray-500 dark:text-gray-400" colSpan={6}>
                  {t('bugReport.admin.loading', 'Loading…')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-2 py-2 text-gray-500 dark:text-gray-400" colSpan={6}>
                  {t('bugReport.admin.empty', 'No entries found.')}
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t border-gray-200 dark:border-gray-700 align-top">
                  <td className="px-2 py-1 font-mono">{it.id}</td>
                  <td className="px-2 py-1">{it.status}</td>
                  <td className="px-2 py-1">{it.priority}</td>
                  <td className="px-2 py-1 break-all">{it.url}</td>
                  <td className="px-2 py-1">{it.description}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{it.ts}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
