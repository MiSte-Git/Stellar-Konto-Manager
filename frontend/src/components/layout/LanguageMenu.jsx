import React from 'react';
import { useTranslation } from 'react-i18next';

import { languages } from '../../config/languages.js';
import NavIcon from './NavIcon.jsx';

/** Kompakte Sprachauswahl fuer die Titelleiste (Flagge + Dropdown). */
export default function LanguageMenu() {
  const { i18n, t } = useTranslation(['menu']);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const buttonRef = React.useRef(null);

  const current =
    languages.find((l) => i18n.language === l.code || i18n.language?.startsWith(l.code)) || languages[0];

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code) => {
    i18n.changeLanguage(code);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const label = t('menu:language', 'Sprache');

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.name}`}
        title={label}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800"
      >
        <span className={`fi fi-${current.flag} rounded-xs`} aria-hidden="true" />
        <span className="uppercase text-xs">{current.code}</span>
        <NavIcon name="chevronDown" className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={label}
          className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {languages.map((lang) => {
            const active = lang.code === current.code;
            return (
              <li key={lang.code} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(lang.code)}
                  className={`flex w-full items-center gap-2.5 rounded-none border-0 px-3 py-1.5 text-left text-sm ${
                    active
                      ? 'bg-blue-50 font-semibold text-blue-800 hover:bg-blue-50 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-800'
                      : 'bg-transparent font-normal text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`fi fi-${lang.flag} rounded-xs`} aria-hidden="true" />
                  <span>{lang.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
