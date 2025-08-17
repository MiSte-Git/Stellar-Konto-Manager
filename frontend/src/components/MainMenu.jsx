import React from 'react';
import { useTranslation } from 'react-i18next';

function MainMenu({ onSelect }) {
  const { t } = useTranslation();

  const buttons = [
    { label: t('trustline.all'), value: 'listAll' },
    { label: t('trustline.compare'), value: 'compare' },
    { label: t('token.purchases'), value: 'payments' },
    { label: t('menu.xlmByMemo'), value: 'xlmByMemo' },
    { label: t('settings.label'), value: 'settings' },
    { label: t('navigation.backToPublicKey'), value: 'backToPublicKey' }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
      {buttons.map((btn) => (
        <button
          key={btn.value}
          onClick={() => onSelect(btn.value)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

export default MainMenu;
