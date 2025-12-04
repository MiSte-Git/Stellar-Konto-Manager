// frontend/src/utils/formatErrorForUi.js
// Utility to normalize error messages with the submitTransaction.failed: prefix
// so UIs can show a consistent, translated message.
//
// Usage:
//   const text = formatErrorForUi(t, err);
//   const { formatted, raw, detail } = formatErrorForUi(t, err, { returnParts: true });

/**
 * Format an error or message for UI display using i18n.
 * - Recognizes the 'submitTransaction.failed:' prefix and renders
 *   "Transaction failed: <translated detail>" (or custom base key/default).
 * - Falls back to t(raw, raw) for non-prefixed messages.
 *
 * @param {(key: string, defaultValue?: string|object) => string} t - i18n translate function
 * @param {unknown} errorOrMessage - Error instance or raw string key
 * @param {{ baseKey?: string, baseDefault?: string, returnParts?: boolean }} [opts]
 * @returns {string|{ formatted: string, raw: string, detail: string }}
 */
export function formatErrorForUi(t, errorOrMessage, opts = {}) {
  const baseDefault = opts.baseDefault || 'Transaction failed';
  const prefix = 'submitTransaction.failed:';

  const raw = String((errorOrMessage && errorOrMessage.message) ? errorOrMessage.message : errorOrMessage || '');

  if (raw.startsWith(prefix)) {
    const detail = raw.slice(prefix.length).trim();
    let detailText = detail;
    if (detail) {
      const detailKeyFull = `errors:submitTransaction.failed.${detail}`;
      const translated = t(detailKeyFull, detailKeyFull);
      if (translated && translated !== detailKeyFull) {
        detailText = translated;
      }
    }
    const formatted = `${baseDefault}: ${detailText || detail || ''}`.trim();
    return opts.returnParts ? { formatted, raw, detail } : formatted;
  }

  const formatted = t(raw, raw);
  return opts.returnParts ? { formatted, raw, detail: raw } : formatted;
}
