// Event, mit dem eine Seite den XLM-Saldo in der Kopfzeile (main.jsx) neu laden laesst,
// z. B. nach einer gesendeten Zahlung. detail.accountId: nur fuer dieses Konto.
export const BALANCE_REFRESH_EVENT = 'stm-balance-refresh';

export function requestHeaderBalanceRefresh(accountId = '') {
  try {
    window.dispatchEvent(new CustomEvent(BALANCE_REFRESH_EVENT, { detail: { accountId } }));
  } catch { /* noop */ }
}
