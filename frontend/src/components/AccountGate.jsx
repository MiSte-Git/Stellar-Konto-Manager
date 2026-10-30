import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Platzhalter fuer kontoabhaengige Seiten, wenn kein Konto geladen ist oder das
 * Konto im aktuellen Netz nicht existiert. Verhindert, dass Seiten mit leeren
 * bzw. fremden Daten (z. B. dem zuvor geladenen Konto) und irrefuehrenden
 * Pruefmeldungen gerendert werden.
 * neutralNotFoundText ersetzt den Text zur Aktivierung, wo das Konto vermutlich nur im
 * falschen Netz gesucht wird.
 */
export default function AccountGate({ title = '', publicKey = '', notFound = false, netName = '', neutralNotFoundText = '' }) {
  const { t } = useTranslation(['common', 'wallet']);
  return (
    <div className="max-w-3xl mx-auto px-3 my-8 text-center" data-testid="account-gate">
      {title && <h2 className="text-xl font-semibold mb-3">{title}</h2>}
      {notFound && neutralNotFoundText ? (
        <div className="inline-block text-left border border-gray-200 bg-gray-50 rounded-sm p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" data-testid="account-gate-neutral">
          <p>{neutralNotFoundText}</p>
          {publicKey && <p className="mt-2 text-xs font-mono break-all">{publicKey}</p>}
        </div>
      ) : notFound ? (
        <div className="inline-block text-left border border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-900/30 rounded-sm p-3">
          <div className="font-semibold text-red-900 dark:text-red-100">
            {t('wallet:home.notFound.title', 'Konto noch nicht aktiviert')}
          </div>
          <p className="mt-1 text-sm text-red-800 dark:text-red-200">
            {t('wallet:home.notFound.text', { net: netName })}
          </p>
          {publicKey && (
            <p className="mt-2 text-xs font-mono break-all text-red-800/80 dark:text-red-200/80">{publicKey}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-700 dark:text-gray-200">{t('common:accountGate.noAccount')}</p>
      )}
    </div>
  );
}
