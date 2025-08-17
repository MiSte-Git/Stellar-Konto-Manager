import React from 'react';
import { useTranslation } from 'react-i18next';

const languages = [
  { code: 'de', label: '🇩🇪', name: 'Deutsch' },
  { code: 'en', label: '🇺🇸', name: 'English' },
  { code: 'fr', label: '🇫🇷', name: 'Français' },
  { code: 'es', label: '🇪🇸', name: 'Español' },
  { code: 'it', label: '🇮🇹', name: 'Italiano' },
  { code: 'nl', label: '🇳🇱', name: 'Nederlands' },
  { code: 'fi', label: '🇫🇮', name: 'Suomi' },
  { code: 'hr', label: '🇭🇷', name: 'Hrvatski' },
  { code: 'ru', label: '🇷🇺', name: 'Русский' }
];


function LanguageSelector() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="lex justify-center space-x-2 w-full">
      {languages.map((lang) => {
        const isActive = i18n.language === lang.code || i18n.language.startsWith(lang.code);
        console.log('Aktuelle Sprache:', i18n.language);
        return (
          <button
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            title={lang.name}
            className={
              isActive
                ? 'bg-red-500 text-white font-bold border border-black px-4 py-2'
                : 'bg-gray-200 text-black border px-4 py-2'
            }
          >
            {lang.label} {isActive ? '*' : ''}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageSelector;
