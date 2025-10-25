import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

/**
 * SmallAdminLink zeigt einen unauffälligen Bugtracker-Link unten rechts.
 * Öffnet ein kleines Secret-Modal und navigiert anschließend zur Admin-Ansicht.
 */
export default function SmallAdminLink() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [portalRoot, setPortalRoot] = useState(null);

  // Öffnet das Modal und lädt das aktuell gespeicherte Secret vor.
  const handleLinkClick = (event) => {
    event.preventDefault();
    if (typeof window === 'undefined') return;
    const current = window.localStorage?.getItem('BUGTRACKER_ADMIN_TOKEN') || '';
    setSecret(current);
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

  return (
    <div className="fixed bottom-2 right-3 text-xs opacity-60 hover:opacity-100 transition-opacity pointer-events-auto">
      <a
        href={buildPath('bugtracker')}
        onClick={handleLinkClick}
        className="underline decoration-dotted"
        aria-label={t('bugReport.admin.link')}
        title={t('bugReport.admin.link')}
      >
        {t('bugReport.admin.link')}
      </a>

      {isOpen && portalRoot && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsOpen(false);
          }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div className="relative max-h-[90vh] w-[min(92vw,420px)] overflow-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4">
            <h2 className="text-base font-semibold mb-3">{t('bugReport.admin.enterSecret')}</h2>
            <label className="block text-xs mb-1">{t('bugReport.admin.enterSecret')}</label>
            <input
              type="password"
              className="w-full border rounded px-2 py-2 mb-4"
              placeholder={t('bugReport.admin.secretPlaceholder')}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setIsOpen(false)}
                title={t('bugReport.admin.cancel')}
              >
                {t('bugReport.admin.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleConfirm}
                title={t('bugReport.admin.confirm')}
              >
                {t('bugReport.admin.confirm')}
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}
    </div>
  );
}
