import i18n from '../i18n.js';

// Das Backend meldet diesen Code, wenn das Speichern eines Jobs scheitert, nachdem die Transaktion
// schon an Horizon gesendet wurde (Anlegen oder Signatur hinzufuegen, B3-1). Die Transaktion kann
// im Netz sein; der Nutzer soll den Status pruefen und nicht erneut senden.
export const SAVE_FAILED_AFTER_SUBMIT = 'multisig.jobs.save_failed_after_submit';

// Beide Backends lehnen Fee-Bump-Transaktionen als Job ausdruecklich ab (#15).
export const FEE_BUMP_NOT_SUPPORTED = 'fee_bump_not_supported';

// F-8: Ohne Signer-Daten legt kein Backend einen Job an: Horizon nicht erreichbar (503) bzw.
// Konto im Netz unbekannt (400). Kommt nur beim Anlegen vor.
export const HORIZON_UNAVAILABLE = 'horizon_unavailable';
export const ACCOUNT_NOT_FOUND = 'account_not_found';

/**
 * Text fuer einen Fehlercode des Multisig-Backends. Fuer save_failed_after_submit,
 * fee_bump_not_supported, horizon_unavailable und account_not_found der uebersetzte Hinweis, sonst
 * der Code selbst (oder fallback), wie bisher.
 */
export function backendErrorMessage(code, fallback = '') {
  if (code === SAVE_FAILED_AFTER_SUBMIT) return i18n.t(SAVE_FAILED_AFTER_SUBMIT);
  if (code === FEE_BUMP_NOT_SUPPORTED) return i18n.t('multisig:errors.feeBump');
  if (code === HORIZON_UNAVAILABLE) return i18n.t('multisig:errors.createHorizonUnavailable');
  if (code === ACCOUNT_NOT_FOUND) return i18n.t('multisig:errors.accountNotFound');
  return code || fallback;
}
