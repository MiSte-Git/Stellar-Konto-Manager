// src/components/MenuHeader.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Zeigt einen Zurück-zum-Menü-Button und optional den aktuellen Menüpfad.
 * @param {function} setMenuSelection - Funktion zum Zurücksetzen auf das Hauptmenü
 * @param {string} [menuSelection] - Aktueller Menüstatus (z. B. 'listAll')
 */
function MenuHeader({ setMenuSelection }) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-between items-center mb-4">
      <button
        onClick={() => setMenuSelection(null)}
        className="px-3 py-1 bg-gray-300 text-black rounded hover:bg-gray-400 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
      >
        {t('navigation.backToMainMenu')}
      </button>
    </div>
  );
}

export default MenuHeader;
