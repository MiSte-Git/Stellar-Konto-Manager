// Reine Funktionen fuer die Kontoliste im Trading (Token suchen und handeln, Modus Im Konto).

/** Token des Kontos aus den Horizon-Balances (ohne XLM und Pool-Anteile), sortiert nach Code und Issuer. */
export function tokensFromAccount(account) {
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  return balances
    .filter((b) => b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12')
    .map((b) => ({
      code: String(b.asset_code || ''),
      issuer: String(b.asset_issuer || ''),
      balance: String(b.balance ?? '0'),
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || a.issuer.localeCompare(b.issuer));
}

export function tokenKey(token) {
  return `${token.code}:${token.issuer}`;
}

/** Standard der Ausblende-Einstellung (Entscheidung 13.11.: Schalter aus, SCAM vorausgewaehlt). */
export const DEFAULT_HIDE_OPTIONS = Object.freeze({ enabled: false, scam: true, zero: false, noMarket: false });

/**
 * true, wenn der Token bei den gewaehlten Kriterien ausgeblendet wird. Nur sichere Befunde blenden aus:
 * 'unknown' oder 'loading' (nicht pruefbar oder noch offen) lassen den Token sichtbar.
 */
export function isTokenHidden(token, options, flags) {
  if (!options?.enabled) return false;
  if (options.zero && Number(token.balance) === 0) return true;
  if (options.scam && flags?.scam?.[token.issuer] === 'yes') return true;
  if (options.noMarket && flags?.market?.[tokenKey(token)] === 'no') return true;
  return false;
}
