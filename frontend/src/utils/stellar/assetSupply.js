// Holder und Menge eines Assets aus dem Horizon-Datensatz /assets (asset_code, asset_issuer).
// Horizon zaehlt nur Trustlines anderer Konten: der Issuer haelt keine Trustline, sein Bestand ist unbegrenzt
// und gehoert nicht zur Menge. Betraege als Strings mit hoechstens 7 Nachkommastellen, Summen exakt per BigInt.

const AMOUNT_RE = /^\d{1,19}(\.\d{1,7})?$/;
const COUNT_RE = /^\d{1,15}$/;

/** Betrag als BigInt in Stroops (1e-7), sonst null. */
function toStroops(value) {
  if (typeof value !== 'string' || !AMOUNT_RE.test(value)) return null;
  const [int, frac = ''] = value.split('.');
  return BigInt(int) * 10000000n + BigInt(frac.padEnd(7, '0'));
}

function fromStroops(n) {
  const int = n / 10000000n;
  const frac = (n % 10000000n).toString().padStart(7, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}

function toCount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && COUNT_RE.test(value)) return Number(value);
  return null;
}

/** Summe der drei Autorisierungsstufen (accounts bzw. balances), nur wenn alle vorhanden und gueltig. */
function splitParts(obj, parse) {
  if (!obj || typeof obj !== 'object') return null;
  const authorized = parse(obj.authorized);
  const maintain = parse(obj.authorized_to_maintain_liabilities);
  const unauthorized = parse(obj.unauthorized);
  if (authorized === null || maintain === null || unauthorized === null) return null;
  return { authorized, maintain, unauthorized };
}

/**
 * Liefert { holders, supply } oder null, wenn der Datensatz nicht zum Asset passt oder unlesbar ist.
 * holders: { total, authorized, maintain, unauthorized } (Anzahl Trustlines)
 * supply: { total, trustlines, claimable, pools, contracts } als Strings; claimable, pools, contracts nur,
 * wenn groesser 0.
 */
export function assetSupplyFromRecord(record, code, issuer) {
  if (!record || typeof record !== 'object') return null;
  if (record.asset_code !== code || record.asset_issuer !== issuer) return null;
  const accounts = splitParts(record.accounts, toCount);
  const balances = splitParts(record.balances, toStroops);
  if (!accounts || !balances) return null;
  const trustlines = balances.authorized + balances.maintain + balances.unauthorized;
  const extra = {};
  let total = trustlines;
  for (const [key, field] of [['claimable', 'claimable_balances_amount'], ['pools', 'liquidity_pools_amount'], ['contracts', 'contracts_amount']]) {
    if (record[field] === undefined) continue;
    const v = toStroops(record[field]);
    if (v === null) return null;
    if (v > 0n) extra[key] = fromStroops(v);
    total += v;
  }
  return {
    holders: {
      total: accounts.authorized + accounts.maintain + accounts.unauthorized,
      authorized: accounts.authorized,
      maintain: accounts.maintain,
      unauthorized: accounts.unauthorized,
    },
    supply: { total: fromStroops(total), trustlines: fromStroops(trustlines), ...extra },
  };
}

/** Den Datensatz genau dieses Assets aus einer /assets-Antwort waehlen (Code mit Gross-/Kleinschreibung). */
export function pickAssetRecord(records, code, issuer) {
  if (!Array.isArray(records)) return null;
  return records.find((r) => r && r.asset_code === code && r.asset_issuer === issuer) || null;
}
