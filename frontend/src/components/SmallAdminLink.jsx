import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

/**
 * SmallAdminLink zeigt einen unauffälligen Bugtracker-Link unten rechts.
 * Öffnet ein kleines Secret-Modal und navigiert anschließend zur Admin-Ansicht.
 */
export default function SmallAdminLink() {
  const { t } = useTranslation(['common']);
  const [isOpen, setIsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [portalRoot, setPortalRoot] = useState(null);

  // Öffnet das Modal mit leerem Eingabefeld.
  const handleLinkClick = (event) => {
    event.preventDefault();
    if (typeof window === 'undefined') return;
    setSecret('');
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
        aria-label={t('common:bugReport.admin.link')}
        title={t('common:bugReport.admin.link')}
      >
        {t('common:bugReport.admin.link')}
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
            <input
              type="password"
              className="w-full border rounded px-2 py-2 mb-4"
              placeholder={t('common:bugReport.admin.secretPlaceholder')}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoFocus
            />
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
