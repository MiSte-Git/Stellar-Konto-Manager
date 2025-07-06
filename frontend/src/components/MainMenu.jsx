import React from 'react';
import { useTranslation } from 'react-i18next';

function MainMenu({ onSelect }) {
  const { t } = useTranslation();

  const buttons = [
    { label: t('listTrustlines'), value: 'list' },
    { label: t('compareTrustlines'), value: 'compare' },
    { label: t('deleteByIssuer'), value: 'deleteByIssuer' },
    { label: t('deleteAll'), value: 'deleteAll' },
    { label: t('tokenPurchasesTitle'), value: 'payments' },
    { label: t('settings'), value: 'settings' },
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
