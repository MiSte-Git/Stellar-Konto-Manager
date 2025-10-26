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
    <div className="flex justify-center space-x-2 w-full">
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
              isActive
                ? 'bg-red-500 text-white font-bold border border-black px-4 py-2'
                : 'bg-gray-200 text-black border px-4 py-2'
            }
          >
            <img src={lang.src} alt={lang.name} className="inline-block w-6 h-4 align-middle" />{isActive ? ' *' : ''}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageSelector;
