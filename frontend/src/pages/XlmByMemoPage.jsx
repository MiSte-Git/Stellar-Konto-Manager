import React from 'react';
import { horizonUrlFor } from '../config/networks.js';
import { useTranslation } from 'react-i18next';
import XlmByMemoPanel from '../components/XlmByMemoPanel';

/**
 * Seite: Zeigt die XLM-Summe nach Memo für den aktuell gesetzten Public Key.
 *  - Alle sichtbaren Texte gehen über i18n t().
 */
export default function XlmByMemoPage({ publicKey, network = 'PUBLIC', onBack }) {
  const { t } = useTranslation(['xlmByMemo']);

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
      {/* Netz aus dem Kopf (vorher fest Mainnet, auch bei Testnet). */}
      <XlmByMemoPanel publicKey={publicKey} horizonUrl={horizonUrlFor(network)} onBack={onBack} />
    </div>
  );
}
