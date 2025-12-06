import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

/**
 * SmallGlossaryLink: unobtrusive link to the Glossary page at the bottom-right.
 * Similar style to the SmallAdminLink, positioned slightly above it.
 */
export default function SmallGlossaryLink() {
  const { t } = useTranslation(['menu']);
  return (
    <div className="fixed bottom-8 right-3 text-xs opacity-60 hover:opacity-100 transition-opacity pointer-events-auto">
      <a
        href={buildPath('glossar')}
        onClick={(e) => {
          try {
            e.preventDefault();
            const url = buildPath('glossar');
            // remember previous path to restore on back
            try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
            window.history.pushState({}, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch { /* noop */ }
        }}
        className="underline decoration-dotted"
              aria-label={t('menu:glossary', 'Glossar')}
      title={t('menu:glossary', 'Glossar')}
    >
      {t('menu:glossary', 'Glossar')}

      </a>
    </div>
  );
}
