// Reine Berechnungen fuer die Wallet-Startseite (ohne Netzwerkzugriff).

export const DEFAULT_BASE_RESERVE_XLM = 0.5;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fasst ein Horizon-Account-Objekt fuer die Startseite zusammen.
 * Mindestreserve nach Stellar-Regel: (2 + Subentries + Sponsoring - Sponsored) * Base Reserve.
 * Verfuegbar = XLM-Guthaben - Mindestreserve - Verkaufsverbindlichkeiten (nie negativ).
 */
export function computeWalletSummary(account, baseReserve = DEFAULT_BASE_RESERVE_XLM) {
  if (!account) return null;
  const balances = Array.isArray(account.balances) ? account.balances : [];
  const native = balances.find((b) => b.asset_type === 'native') || null;
  const xlm = num(native?.balance);
  const sellingLiabilities = num(native?.selling_liabilities);
  const entries =
    2 +
    num(account.subentry_count) +
    num(account.num_sponsoring) -
    num(account.num_sponsored);
  const minReserve = Math.max(0, entries) * baseReserve;
  const available = Math.max(0, xlm - minReserve - sellingLiabilities);

  const assets = balances
    .filter((b) => b.asset_type !== 'native')
    .map((b) => {
      const isPool = b.asset_type === 'liquidity_pool_shares';
      return {
        key: isPool ? `pool:${b.liquidity_pool_id}` : `${b.asset_code}:${b.asset_issuer}`,
        isPool,
        code: isPool ? '' : String(b.asset_code || ''),
        issuer: isPool ? String(b.liquidity_pool_id || '') : String(b.asset_issuer || ''),
        balance: num(b.balance),
      };
    })
    .sort((a, b) => {
      if (a.isPool !== b.isPool) return a.isPool ? 1 : -1;
      return a.code.localeCompare(b.code) || a.issuer.localeCompare(b.issuer);
    });

  return { xlm, minReserve, sellingLiabilities, available, assets };
}

/** Kuerzt eine Adresse auf Anfang und Ende (genug Zeichen gegen Verwechslung). */
export function shortenAddress(value, head = 6, tail = 6) {
  const s = String(value || '');
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Teilt eine Adresse in 4er-Gruppen, damit sie sich leichter vergleichen laesst. */
export function groupAddress(address, size = 4) {
  const s = String(address || '');
  const parts = [];
  for (let i = 0; i < s.length; i += size) parts.push(s.slice(i, i + size));
  return parts;
}
