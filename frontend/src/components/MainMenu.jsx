import React from 'react';
import { useTranslation } from 'react-i18next';

import { MAIN_MENU_NAV } from '../config/mainNavigation.js';

function MainMenu({ onSelect }) {
  // Explicitly request the namespaces used here to ensure they are loaded
  const { t } = useTranslation(['menu', 'createAccount', 'multisigEdit', 'trading']);

  const buttons = MAIN_MENU_NAV.map((item) => ({
    ...item,
    value: item.id,
    label: t(item.labelKey, item.fallback || item.id),
    title: item.titleKey ? t(item.titleKey, item.titleFallback || '') : '',
  }));

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
        <button
          key={btn.value}
          onClick={() => onSelect(btn.value)}
          className={`${baseBtn} ${groupStyle[btn.group]}`}
          title={btn.title || ''}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

export default MainMenu;
