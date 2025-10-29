import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

/**
 * SmallGlossaryLink: unobtrusive link to the Glossary page at the bottom-right.
 * Similar style to the SmallAdminLink, positioned slightly above it.
 */
export default function SmallGlossaryLink() {
  const { t } = useTranslation();
  return (
    <div className="fixed bottom-8 right-3 text-xs opacity-60 hover:opacity-100 transition-opacity pointer-events-auto">
      <a
        href={buildPath('glossar')}
        className="underline decoration-dotted"
        aria-label={t('menu.glossary', 'Glossary')}
        title={t('menu.glossary', 'Glossary')}
      >
        {t('menu.glossary', 'Glossary')}
      </a>
    </div>
  );
}
