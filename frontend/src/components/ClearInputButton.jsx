import React from 'react';
import { useTranslation } from 'react-i18next';

/** Runder Loeschen-Button rechts im Eingabefeld; das Feld braucht einen relativ positionierten Rahmen. */
export default function ClearInputButton({ onClick }) {
  const { t } = useTranslation(['common']);
  const label = t('common:clear', 'Clear');
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center"
    >
      ×
    </button>
  );
}
