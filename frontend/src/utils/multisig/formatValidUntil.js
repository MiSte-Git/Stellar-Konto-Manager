// Formats a transaction's timeBounds.maxTime (unix seconds as a string, "0"
// meaning unbounded - Stellar's own convention) as a localized date/time for
// display, shared by the multisig job-detail transparency panel and the
// job-creation summary dialogs (G5 stage 2).
//
// @param {string|number|undefined} maxTime - tx.timeBounds.maxTime
// @param {string|undefined} language - i18n.language
// @param {(key: string, opts?: object) => string} t - react-i18next translate function
// @returns {string}
export function formatValidUntil(maxTime, language, t) {
  if (!maxTime || maxTime === '0') return t('multisig:detail.validUntil.unbounded', 'unbegrenzt');
  const dateMs = Number(maxTime) * 1000;
  if (!Number.isFinite(dateMs)) return '-';
  try {
    return new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateMs));
  } catch {
    return new Date(dateMs).toISOString();
  }
}
