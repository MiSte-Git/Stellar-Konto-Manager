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
    'text-white bg-black hover:bg-zinc-900 ' +
    'px-4 py-2 rounded font-medium shadow-sm transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-zinc-400 focus-visible:ring-offset-white ' +
    'dark:focus-visible:ring-offset-gray-900 ' +
    'border';

  const groupBorder = {
    1: 'border-green-400',
    2: 'border-orange-400',
    3: 'border-amber-400',
    4: 'border-sky-400',
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
      {buttons.map((btn) => (
        <button
          key={btn.value}
          onClick={() => onSelect(btn.value)}
          className={`${baseBtn} ${groupBorder[btn.group] || 'border-zinc-700'}`}
          title={btn.title || ''}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

export default MainMenu;
