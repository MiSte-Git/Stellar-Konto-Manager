import React from 'react';
import { useTranslation } from 'react-i18next';

// T7: Konto auf Mainnet nicht gefunden, im Verlauf aber als Testnet-Konto bekannt.
// Wechsel nur per Knopf (gleiches Verhalten wie die Testnet-Checkbox), nie automatisch.
export default function TestnetOnlyHint({ onSwitch }) {
  const { t } = useTranslation(['errors']);
  return (
    <div className="mb-3 text-xs text-gray-700 dark:text-gray-200" role="status" data-testid="testnet-only-hint">
      <span>{t('errors:accountOnlyOnTestnet')}</span>
      <button type="button" className="ml-2 px-2 py-0.5 rounded-sm border text-xs" onClick={onSwitch}>
        {t('errors:switchToTestnet')}
      </button>
    </div>
  );
}
