import React from 'react';
import { useTranslation } from 'react-i18next';

// Hinweis: Wir verwenden die CSS-Variante von flag-icons (fi fi-xx),
// damit auf Mobilgeräten keine Probleme mit Asset-Pfaden auftreten.
// Die CSS wird global in src/index.css bzw. App.jsx importiert.

const languages = [
  { code: 'de', name: 'Deutsch', flag: 'de' },
  { code: 'en', name: 'English', flag: 'us' },
  { code: 'fr', name: 'Français', flag: 'fr' },
  { code: 'es', name: 'Español', flag: 'es' },
  { code: 'it', name: 'Italiano', flag: 'it' },
  { code: 'nl', name: 'Nederlands', flag: 'nl' },
  { code: 'fi', name: 'Suomi', flag: 'fi' },
  { code: 'hr', name: 'Hrvatski', flag: 'hr' },
  { code: 'ru', name: 'Русский', flag: 'ru' }
];

function LanguageSelector() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="w-full overflow-x-auto sm:overflow-visible">
      <div className="inline-flex items-center gap-2 py-1">
        {languages.map((lang) => {
          const isActive = i18n.language === lang.code || i18n.language?.startsWith(lang.code);

          return (
            <button
              key={lang.code}
              onClick={() => changeLanguage(lang.code)}
              title={lang.name}
              aria-label={lang.name}
              aria-pressed={isActive}
              className={
                `relative shrink-0 inline-flex items-center justify-center rounded-md border px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 ` +
                (isActive
                  ? 'ring-2 ring-indigo-500 border-indigo-500 bg-white dark:bg-gray-800'
                  : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700')
              }
            >
              {/* Stern auf dem Button, oben rechts, nicht auf der Flagge */}
              {isActive && (
                <span
                  className="absolute -top-1 -right-1 text-yellow-500"
                  aria-hidden="true"
                  title="active"
                >
                  ★
                </span>
              )}
              <span
                className={`fi fi-${lang.flag}`}
                aria-hidden="true"
                style={{ fontSize: '18px', lineHeight: 1 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LanguageSelector;
