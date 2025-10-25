import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BugTrackerAdmin: Minimal-Admin-UI (Platzhalter).
 * Prüft Secret in localStorage gegen VITE_BUGTRACKER_ADMIN_SECRET.
 * Nächste Patches liefern Liste, Filter und API-Aufrufe.
 */
export default function BugTrackerAdmin() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  // checkAccess: Vergleicht lokales Token mit dem Build-Secret.
  const ok = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      const token = window.localStorage?.getItem('BUGTRACKER_ADMIN_TOKEN') || '';
      const secret = import.meta.env.VITE_BUGTRACKER_ADMIN_SECRET || '';
      return Boolean(token) && token === secret;
    } catch (e) {
      console.error('BugTracker admin check failed:', e);
      return false;
    }
  }, []);

  useEffect(() => {
    setReady(true);
  }, []);

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
      <h1 className="text-2xl font-semibold mb-4">{t('bugReport.admin.title')}</h1>
      <p className="text-sm mb-6">{t('bugReport.admin.placeholder')}</p>
      {/* Nächster Patch: Tabelle, Filter, GET/PATCH-Integration */}
    </div>
  );
}
