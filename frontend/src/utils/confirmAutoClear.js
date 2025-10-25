/**
 * confirmAutoClear: Globale Aufräumlogik für Bestätigungs-Meldungen.
 * Entfernt sessionStorage-Flag und sendet Events, um UI-Toast-Reste zu schließen.
 */
export function confirmAutoClear() {
  const CLEAR_KEY = 'stm.confirmation';

  const removeDomToasts = () => {
    try {
      document.querySelectorAll('[data-confirm-toast="true"]').forEach((el) => el.remove());
    } catch {
      /* noop */
    }
  };

  const clearConfirmation = (reason = '') => {
    try {
      window.sessionStorage.removeItem(CLEAR_KEY);
    } catch {
      /* noop */
    }
    try {
      window.dispatchEvent(new CustomEvent('stm:clearConfirm', { detail: { reason } }));
    } catch {
      /* noop */
    }
    removeDomToasts();
  };

  window.addEventListener('beforeunload', () => clearConfirmation('beforeunload'));
  window.addEventListener('pagehide', () => clearConfirmation('pagehide'));
  window.addEventListener('popstate', () => clearConfirmation('popstate'));
  window.addEventListener('hashchange', () => clearConfirmation('hashchange'));
  window.addEventListener('stm:accountChanged', () => clearConfirmation('accountChanged'));

  clearConfirmation('init');

  return { clearConfirmation };
}
