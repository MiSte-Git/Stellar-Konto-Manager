// src/pages/SettingsPage.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPanel from '../components/SettingsPanel';

/**
 * Zeigt die Einstellungsseite mit Überschrift und einem "Zurück zum Menü"-Button.
 * @param {string} publicKey - Der aktuell geladene Public Key
 * @param {function} onBack - Callback zum Zurückkehren ins Hauptmenü
 */
export default function SettingsPage({ publicKey, onBack: _onBack }) {
  const { t } = useTranslation(['settings']);
  void _onBack;

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings:label', 'Settings')}</h1>
      </div>

            <SettingsPanel publicKey={publicKey} />
    </div>
  );
}
