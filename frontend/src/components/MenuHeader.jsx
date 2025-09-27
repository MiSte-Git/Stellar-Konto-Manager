// src/components/MenuHeader.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Zeigt einen Zurück-zum-Menü-Button und optional den aktuellen Menüpfad.
 * @param {function} _setMenuSelection - Funktion zum Zurücksetzen auf das Hauptmenü
 * @param {string} [menuSelection] - Aktueller Menüstatus (z. B. 'listAll')
 */
function MenuHeader({ _setMenuSelection }) {
  const { t } = useTranslation();
  void t; // aktuell keine sichtbare Nutzung
  void _setMenuSelection;

  return (
    <div className="flex justify-between items-center mb-4">
    </div>
  );
}

export default MenuHeader;
