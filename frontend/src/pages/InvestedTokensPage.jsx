import React from 'react';
import { useTranslation } from 'react-i18next';
import InvestedTokensPanel from '../components/InvestedTokensPanel';

/**
 * Seite für „Anzahl gekaufter Token“ hinter dem Menüpunkt token.purchases.
 * - Zeigt Titel + Zurück-Button (UI-Texte via t()).
 * - Rendert das Panel, das die Investments über Horizon ermittelt.
 */
export default function InvestedTokensPage({ publicKey, onBack }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Kopfbereich mit zentriertem Titel */}
      <div className="text-center">
        <h2 className="text-xl font-semibold">{t('token.purchases')}</h2>
        <button
          className="border rounded px-3 py-1"
          onClick={onBack}
          aria-label={t('navigation.back', 'Back')}
          title={t('navigation.back', 'Back')}
        >
          {t('navigation.back', 'Back')}
        </button>
      </div>

      {/* Inhalt: Panel mit Gruppierungs-/Lade-Logik */}
      <InvestedTokensPanel publicKey={publicKey} />
    </div>
  );
}
