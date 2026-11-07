import React from 'react';
import { useTranslation } from 'react-i18next';
import InvestedTokensPanel from '../components/InvestedTokensPanel';

/**
 * Seite „Memo-Einzahlungen“ (früher Token-Käufe) hinter dem Menüpunkt token.purchases.
 * - Zeigt Titel + Zurück-Button (UI-Texte via t()).
 * - Rendert das Panel, das die Investments über Horizon ermittelt.
 */
export default function InvestedTokensPage({ publicKey, onBack: _onBack }) {
  const { t } = useTranslation(['token', 'investedTokens']);
  void _onBack;

  return (
    <div className="space-y-4">
      {/* Kopfbereich mit zentriertem Titel */}
      <div className="text-center">
        <h2 className="text-xl font-semibold">{t('token:purchases')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('investedTokens:hintNoTrustline')}</p>
      </div>

      {/* Inhalt: Panel / Hinweis */}
      {publicKey ? (
        <InvestedTokensPanel publicKey={publicKey} />
      ) : (
        <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
          {t('investedTokens:hintEnterPublicKey')}
        </div>
      )}
    </div>
  );
}
