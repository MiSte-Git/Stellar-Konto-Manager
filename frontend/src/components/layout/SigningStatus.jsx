import React from 'react';
import { useTranslation } from 'react-i18next';

import { ACCOUNT_CHANGED_EVENT, getActiveAccount } from '../../utils/appNavigation.js';
import {
  clearAllSessionSecrets,
  getSessionSecretAccountCount,
  getUsableSignerKeys,
} from '../../utils/sessionSecrets.js';
import NavIcon from './NavIcon.jsx';

const SECRET_CHANGED_EVENT = 'stm-session-secret-changed';

// Gleiche Suche wie getSessionSecret(): Signer des Kontos plus der eigene Key des
// Kontos, auch wenn er unter einem anderen Konto gemerkt wurde (Multisig-Jobs).
function readStatus(publicKey) {
  try {
    const usable = getUsableSignerKeys(publicKey);
    return {
      activeHas: usable.length > 0,
      activeCount: usable.length,
      anyAccounts: getSessionSecretAccountCount(),
    };
  } catch {
    return { activeHas: false, activeCount: 0, anyAccounts: 0 };
  }
}

/**
 * Zeigt in der Titelleiste, ob diese Session signieren kann, und erlaubt das
 * sofortige Sperren. Liest nur Existenz und Anzahl der gespeicherten S-Keys,
 * nie den Inhalt. Sperren loescht die S-Keys aller Konten dieser Session.
 * Auf schmalen Bildschirmen werden die Texte per CSS gekuerzt (eine Instanz,
 * damit es nur einen Live-Status-Bereich gibt).
 */
export default function SigningStatus() {
  const { t } = useTranslation(['secretKey']);
  const [publicKey, setPublicKey] = React.useState(() => getActiveAccount());
  const [status, setStatus] = React.useState(() => readStatus(getActiveAccount()));
  const [justLocked, setJustLocked] = React.useState(false);
  const lockedTimer = React.useRef(null);

  React.useEffect(() => {
    const onAccount = (e) => {
      const pk = typeof e?.detail?.publicKey === 'string' ? e.detail.publicKey : '';
      setPublicKey(pk);
      setStatus(readStatus(pk));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onAccount);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onAccount);
  }, []);

  // sessionStorage gilt nur fuer diesen Tab, alle Aenderungen kommen ueber das
  // Change-Event (Speichern, Sperren, Inaktivitaets-Timeout). Kein Focus-Polling noetig.
  React.useEffect(() => {
    const refresh = () => setStatus(readStatus(publicKey));
    window.addEventListener(SECRET_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SECRET_CHANGED_EVENT, refresh);
  }, [publicKey]);

  React.useEffect(() => () => clearTimeout(lockedTimer.current), []);

  const handleLock = () => {
    clearAllSessionSecrets();
    // Eigenes Event, falls nichts zu loeschen war (Status trotzdem neu lesen)
    try { window.dispatchEvent(new CustomEvent(SECRET_CHANGED_EVENT, { detail: {} })); } catch { /* noop */ }
    setStatus(readStatus(publicKey));
    setJustLocked(true);
    clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setJustLocked(false), 2500);
  };

  if (!publicKey) return null;

  const canSign = status.activeHas;
  const otherOnly = !canSign && status.anyAccounts > 0;
  const showLock = status.anyAccounts > 0;

  const label = canSign
    ? t('secretKey:status.canSign', 'Signieren möglich')
    : t('secretKey:status.viewOnly', 'Nur ansehen');
  const hint = canSign
    ? t('secretKey:status.canSignHint', {
        count: status.activeCount,
        defaultValue: 'Für dieses Konto sind {{count}} Secret Keys verschlüsselt in dieser Browser-Session gespeichert. Sie werden nach 15 Minuten ohne Aktivität oder beim Schliessen des Tabs gelöscht.',
      })
    : otherOnly
      ? t('secretKey:status.otherAccountHint', 'Für dieses Konto ist kein Secret Key gespeichert, aber für ein anderes Konto dieser Session. Sperren löscht alle.')
      : t('secretKey:status.viewOnlyHint', 'Kein Secret Key in dieser Session. Du kannst alles ansehen, aber nichts signieren.');

  return (
    <div className="flex items-center gap-1.5" data-testid="signing-status">
      <span
        role="status"
        aria-live="polite"
        title={hint}
        data-testid="signing-status-chip"
        data-state={canSign ? 'canSign' : 'viewOnly'}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
          canSign
            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200'
            : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
        }`}
      >
        <NavIcon name={canSign ? 'lockOpen' : 'eye'} className="h-4 w-4" />
        {justLocked ? (
          t('secretKey:status.locked', 'Gesperrt')
        ) : canSign ? (
          <>
            <span className="hidden md:inline">{label}</span>
            <span className="md:hidden">{t('secretKey:status.canSignShort', 'Signieren')}</span>
          </>
        ) : (
          label
        )}
        {canSign && status.activeCount > 1 && (
          <span className="rounded-full bg-amber-200/70 px-1.5 text-[10px] tabular-nums dark:bg-amber-400/20">{status.activeCount}</span>
        )}
      </span>
      {showLock && (
        <button
          type="button"
          onClick={handleLock}
          title={t('secretKey:status.lockHint', 'Alle gespeicherten Secret Keys dieser Session sofort löschen')}
          aria-label={t('secretKey:status.lock', 'Sperren')}
          data-testid="signing-status-lock"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-red-400/60 dark:hover:bg-red-500/10 dark:hover:text-red-300"
        >
          <NavIcon name="lock" className="h-4 w-4" />
          <span className="hidden md:inline">{t('secretKey:status.lock', 'Sperren')}</span>
        </button>
      )}
    </div>
  );
}
