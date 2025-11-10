import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

function MainMenu({ onSelect }) {
  const { t } = useTranslation();

  const buttons = [
    // Gruppe 1
    { label: t('multisigCreate:menu', 'Multisig erstellen'), value: 'multisigCreate', title: t('multisigCreate:menuHint', 'Neues Konto erzeugen und optional Multisig setzen'), group: 1 },
    { label: t('menu:sendPayment', 'Zahlung senden'), value: 'sendPayment', group: 1 },
    { label: t('menu:balance', 'Kontoinformation anzeigen'), value: 'balance', group: 1 },

    // Gruppe 2
    { label: t('token:purchases', 'Token-Käufe'), value: 'payments', group: 2 },
    { label: t('menu:xlmByMemo', 'XLM-Betrag nach Memo/Token filtern'), value: 'xlmByMemo', group: 2 },
    // Lernseite als eigener Menüpunkt (öffnet Overlay-Route /learn)
    { label: t('learn:menu', 'Learn'), value: 'learn', group: 2, title: t('learn:menuHint', 'Open learning page') },

    // Gruppe 3
    { label: t('multisigEdit:menu', 'Edit multisig'), value: 'multisigEdit', title: t('multisigEdit:menuHint', 'Edit existing account / signers'), group: 3 },
    { label: t('menu:muxed', 'Muxed-Adressen verwalten'), value: 'muxed', group: 3 },

    // Gruppe 4
    { label: t('trustline:all', 'Alle Trustlines auflisten'), value: 'listAll', group: 4 },
    { label: t('trustline:compare', 'Trustlines vergleichen'), value: 'compare', group: 4 }
  ];

  const baseBtn =
    'text-white px-4 py-2 rounded font-medium shadow-sm transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
    'dark:focus-visible:ring-offset-gray-900';

  const groupStyle = {
    1: 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500',
    2: 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500',
    3: 'bg-violet-500 hover:bg-violet-600 focus-visible:ring-violet-400',
    4: 'bg-violet-700 hover:bg-violet-800 focus-visible:ring-violet-600'
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
      {buttons.map((btn) => (
        btn.value === 'learn' ? (
          <a
            key={btn.value}
            href={buildPath('learn')}
            onClick={(e) => {
              e.preventDefault();
              try {
                const url = buildPath('learn');
                window.history.pushState({}, '', url);
                window.dispatchEvent(new PopStateEvent('popstate'));
              } catch { /* noop */ }
            }}
            className={`${baseBtn} ${groupStyle[btn.group]} inline-flex items-center justify-center`}
            title={btn.title || ''}
            aria-label={btn.title || btn.label}
            role="button"
          >
            {btn.label}
          </a>
        ) : (
          <button
            key={btn.value}
            onClick={() => onSelect(btn.value)}
            className={`${baseBtn} ${groupStyle[btn.group]}`}
            title={btn.title || ''}
          >
            {btn.label}
          </button>
        )
      ))}
    </div>
  );
}

export default MainMenu;
