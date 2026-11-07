import i18n from '../i18n.js';

// Das Backend meldet diesen Code, wenn das Speichern eines Jobs scheitert, nachdem die Transaktion
// schon an Horizon gesendet wurde (Anlegen oder Signatur hinzufuegen, B3-1). Die Transaktion kann
// im Netz sein; der Nutzer soll den Status pruefen und nicht erneut senden.
export const SAVE_FAILED_AFTER_SUBMIT = 'multisig.jobs.save_failed_after_submit';

/**
 * Text fuer einen Fehlercode des Multisig-Backends. Fuer save_failed_after_submit der uebersetzte
 * Hinweis, sonst der Code selbst (oder fallback), wie bisher.
 */
export function backendErrorMessage(code, fallback = '') {
  if (code === SAVE_FAILED_AFTER_SUBMIT) return i18n.t(SAVE_FAILED_AFTER_SUBMIT);
  return code || fallback;
}
