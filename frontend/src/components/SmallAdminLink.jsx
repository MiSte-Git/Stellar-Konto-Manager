import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

export const ADMIN_NAV = [
  {
    id: 'bugtracker',
    to: 'bugtracker',
    labelKey: 'common:feedback.pages.bugtracker',
  },
];

/**
 * SmallAdminLink zeigt einen unauffälligen Bugtracker-Link unten rechts.
 * Öffnet ein kleines Secret-Modal und navigiert anschließend zur Admin-Ansicht.
 */
export default function SmallAdminLink() {
  const { t } = useTranslation(['common']);
  const [isOpen, setIsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [portalRoot, setPortalRoot] = useState(null);

  // Öffnet das Modal mit leerem Eingabefeld.
  const handleLinkClick = (event) => {
    event.preventDefault();
    if (typeof window === 'undefined') return;
    setSecret('');
    setShowSecret(false);
    setIsOpen(true);
  };

  // Bestätigt das Secret, speichert es und navigiert zur Admin-Seite.
  const handleConfirm = () => {
    try {
      const value = String(secret || '').trim();
      if (!value) return;
      window.localStorage?.setItem('BUGTRACKER_ADMIN_TOKEN', value);
      const target = buildPath('bugtracker');
      window.location.assign(target);
    } catch (error) {
      throw new Error('bugReport.admin.navigate.failed:' + (error?.message || 'unknown'));
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const linkLabel = t(ADMIN_NAV[0].labelKey);

  return (
    <div className="fixed bottom-2 right-3 text-xs opacity-60 hover:opacity-100 transition-opacity pointer-events-auto">
      <a
        href={buildPath(ADMIN_NAV[0].to)}
        onClick={handleLinkClick}
        className="underline decoration-dotted"
        aria-label={linkLabel}
        title={linkLabel}
      >
        {linkLabel}
      </a>

      {isOpen && portalRoot && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => { if (e.key === 'Escape') setIsOpen(false); }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div className="relative max-h-[90vh] w-[min(92vw,420px)] overflow-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4">
            <h2 className="text-base font-semibold mb-3">{t('common:bugReport.admin.enterSecret')}</h2>
            <label className="block text-xs mb-1">{t('common:bugReport.admin.enterSecret')}</label>
            <div className="relative mb-4">
              <input
                type={showSecret ? 'text' : 'password'}
                className="w-full border rounded px-2 py-2 pr-10"
                placeholder={t('common:bugReport.admin.secretPlaceholder')}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={t('common:bugReport.admin.secretVisibilityToggle', 'Secret anzeigen/ausblenden')}
                title={t('common:bugReport.admin.secretVisibilityToggle', 'Secret anzeigen/ausblenden')}
              >
                {showSecret ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.67-1.6 1.62-3.05 2.78-4.27" />
                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.89 11 8-0.62 1.49-1.49 2.86-2.56 4.05" />
                    <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                    <path d="M1 1l22 22" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setIsOpen(false)}
                title={t('common:bugReport.admin.cancel')}
              >
                {t('common:bugReport.admin.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleConfirm}
                title={t('common:bugReport.admin.confirm')}
              >
                {t('common:bugReport.admin.confirm')}
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}
    </div>
  );
}
