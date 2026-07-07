import React from 'react';
import { useTranslation } from 'react-i18next';

import { MAIN_MENU_NAV } from '../config/mainNavigation.js';
import GlossaryInfoIcon from './GlossaryInfoIcon.jsx';

function MainMenu({ onSelect }) {
  // Explicitly request the namespaces used here to ensure they are loaded
  const { t } = useTranslation(['menu', 'createAccount', 'multisigEdit', 'trading']);

  const buttons = MAIN_MENU_NAV.map((item) => {
    const label = t(item.labelKey, item.fallback || item.id);
    return {
      ...item,
      value: item.id,
      label,
      // title-Attribut: bevorzugt ein explizites titleKey, sonst das volle Label
      // als Tooltip-Fallback, falls der Text im Button abgeschnitten wird (siehe truncate unten).
      title: item.titleKey ? t(item.titleKey, item.titleFallback || '') : label,
    };
  });

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
        <div key={btn.value} className="relative flex">
          <button
            onClick={() => onSelect(btn.value)}
            className={`flex-1 min-w-0 ${baseBtn} ${groupBorder[btn.group] || 'border-zinc-700'}`}
            title={btn.title || ''}
          >
            <span className="block truncate">{btn.label}</span>
          </button>
          {btn.glossaryTerm && (
            <GlossaryInfoIcon
              term={btn.glossaryTerm}
              className="absolute right-1.5 top-1.5"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default MainMenu;
