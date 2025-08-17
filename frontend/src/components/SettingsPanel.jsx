// src/components/SettingsPanel.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Leeres Panel für Einstellungen. Dient als Platzhalter bis echte Optionen ergänzt werden.
 */
export default function SettingsPanel() {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border p-6">
      <h2 className="text-lg font-semibold mb-2">
        {t('settings.label')}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t('settings.description')}
      </p>
    </div>
  );
}
