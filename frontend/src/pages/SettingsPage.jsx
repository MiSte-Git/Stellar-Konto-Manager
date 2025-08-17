// src/pages/SettingsPage.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPanel from '../components/SettingsPanel';

/**
 * Zeigt die Einstellungsseite mit Überschrift und einem "Zurück zum Menü"-Button.
 * @param {string} publicKey - Der aktuell geladene Public Key
 * @param {function} onBack - Callback zum Zurückkehren ins Hauptmenü
 */
export default function SettingsPage({ publicKey, onBack }) {
  const { t } = useTranslation();

  // Sichtbarer Sentinel, um Render zu beweisen
  console.log('[SettingsPage] render, publicKey=', publicKey);
  
  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings.label')}</h1>
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label={t('navigation.backToMainMenu')}
        >
          {t('navigation.backToMainMenu')}
        </button>
      </div>

      {/* Inhalt: Panel mit Gruppierungs-/Lade-Logik */}
            <SettingsPanel publicKey={publicKey} />
    </div>
  );
}
