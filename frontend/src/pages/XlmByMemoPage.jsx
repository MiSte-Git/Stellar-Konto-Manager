import React from 'react';
import { NETWORKS } from '../config/networks.js';
import { useTranslation } from 'react-i18next';
import XlmByMemoPanel from '../components/XlmByMemoPanel';

/**
 * Seite: Zeigt die XLM-Summe nach Memo für den aktuell gesetzten Public Key.
 *  - Alle sichtbaren Texte gehen über i18n t().
 */
export default function XlmByMemoPage({ publicKey, horizonUrl: _horizonUrl = NETWORKS.PUBLIC.horizonUrl, onBack }) {
  const { t } = useTranslation(['xlmByMemo']);
  void _horizonUrl;

  if (!publicKey) {
    return (
      <div className="p-4">
        {t('xlmByMemo:page.noPublicKey')}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <h2 className="text-center text-xl font-semibold">{t('xlmByMemo:page.title')}</h2>
      <XlmByMemoPanel publicKey={publicKey} horizonUrl={NETWORKS.PUBLIC.horizonUrl} onBack={onBack} />
    </div>
  );
}
