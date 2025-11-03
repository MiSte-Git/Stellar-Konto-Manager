import React from 'react';
import { useTranslation } from 'react-i18next';
import deFlag from 'flag-icons/flags/4x3/de.svg';
import usFlag from 'flag-icons/flags/4x3/us.svg';
import frFlag from 'flag-icons/flags/4x3/fr.svg';
import esFlag from 'flag-icons/flags/4x3/es.svg';
import itFlag from 'flag-icons/flags/4x3/it.svg';
import nlFlag from 'flag-icons/flags/4x3/nl.svg';
import fiFlag from 'flag-icons/flags/4x3/fi.svg';
import hrFlag from 'flag-icons/flags/4x3/hr.svg';
import ruFlag from 'flag-icons/flags/4x3/ru.svg';

const languages = [
  { code: 'de', name: 'Deutsch', src: deFlag },
  { code: 'en', name: 'English', src: usFlag },
  { code: 'fr', name: 'Français', src: frFlag },
  { code: 'es', name: 'Español', src: esFlag },
  { code: 'it', name: 'Italiano', src: itFlag },
  { code: 'nl', name: 'Nederlands', src: nlFlag },
  { code: 'fi', name: 'Suomi', src: fiFlag },
  { code: 'hr', name: 'Hrvatski', src: hrFlag },
  { code: 'ru', name: 'Русский', src: ruFlag }
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
                `shrink-0 inline-flex items-center justify-center rounded-md border px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 ` +
                (isActive
                  ? 'ring-2 ring-indigo-500 border-indigo-500 bg-white dark:bg-gray-800'
                  : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700')
              }
            >
              <img src={lang.src} alt={lang.name} className="block w-6 h-4 sm:w-7 sm:h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LanguageSelector;
