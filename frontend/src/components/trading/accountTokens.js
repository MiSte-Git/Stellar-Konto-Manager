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

/**
 * Standard der Filter-Einstellung (Entscheidung 13.11.): Modus all (alles sichtbar, nichts geprueft),
 * Kriterium Warn-Tag bei StellarExpert vorausgewaehlt.
 * mode: 'all' | 'hide' (passende ausblenden) | 'only' (nur passende zeigen, Wunsch 13.11.)
 */
export const DEFAULT_HIDE_OPTIONS = Object.freeze({ mode: 'all', scam: true, zero: false, noMarket: false });

/**
 * true, wenn der Token mindestens ein gewaehltes Kriterium sicher erfuellt. 'unknown' oder 'loading'
 * (nicht pruefbar oder noch offen) zaehlen nie als Treffer.
 */
export function matchesTokenCriteria(token, options, flags) {
  if (options?.zero && Number(token.balance) === 0) return true;
  if (options?.scam && flags?.scam?.[token.issuer] === 'yes') return true;
  if (options?.noMarket && flags?.market?.[tokenKey(token)] === 'no') return true;
  return false;
}

/**
 * true, wenn der Token bei der Einstellung nicht angezeigt wird. Ausblenden: nur sichere Treffer
 * verschwinden. Nur diese zeigen: nur sichere Treffer bleiben (nicht pruefbare fehlen also dort).
 */
export function isTokenHidden(token, options, flags) {
  const mode = options?.mode || 'all';
  if (mode === 'all') return false;
  const hit = matchesTokenCriteria(token, options, flags);
  return mode === 'hide' ? hit : !hit;
}
