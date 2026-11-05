// Anlegen und Einloesen von Claimable Balances fuer den Verlauf.
//
// Horizon /payments enthaelt diese Operationen nicht. Sie kommen aus /operations und werden
// hier in das Format von /payments-Datensaetzen gebracht (from, to, amount, asset_*), damit
// "Letzte Aktivitaet" und die Verlaufsseite sie wie Zahlungen einsortieren koennen.
//
// - create_claimable_balance, vom geladenen Konto angelegt: ausgehend, Empfaenger ist der
//   Claimant (bei mehreren Claimants der erste, weitere stehen in claimants).
// - claim_claimable_balance, vom geladenen Konto eingeloest: eingehend. Horizon liefert bei der
//   Operation weder Betrag noch Asset; beides steht im Effekt claimable_balance_claimed, der
//   Absender (fruehere Reserve-Sponsor) in claimable_balance_sponsorship_removed.
// Eine fuer das Konto angelegte, noch nicht eingeloeste Balance zeigt das Panel
// "Claimable Balances", nicht der Verlauf.

function assetFields(assetString) {
  const v = String(assetString || '');
  if (!v || v === 'native') return { asset_type: 'native' };
  const idx = v.indexOf(':');
  if (idx <= 0) return { asset_type: 'native' };
  const code = v.slice(0, idx);
  return {
    asset_type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
    asset_code: code,
    asset_issuer: v.slice(idx + 1),
  };
}

function baseFields(op) {
  return {
    id: String(op.id || ''),
    paging_token: String(op.paging_token || op.id || ''),
    type: op.type,
    created_at: op.created_at,
    transaction_hash: op.transaction_hash,
    transaction_successful: op.transaction_successful,
    transaction: op.transaction,
    source_account: op.source_account,
  };
}

/** Wandelt eine create_claimable_balance-Operation um (nur wenn vom Konto angelegt). */
export function createdToPaymentRecord(op, publicKey) {
  if (op?.type !== 'create_claimable_balance' || op.source_account !== publicKey) return null;
  const claimants = Array.isArray(op.claimants) ? op.claimants : [];
  return {
    ...baseFields(op),
    from: publicKey,
    to: String(claimants[0]?.destination || ''),
    claimants: claimants.map((c) => String(c?.destination || '')).filter(Boolean),
    amount: String(op.amount || ''),
    ...assetFields(op.asset),
  };
}

/** Wandelt eine claim_claimable_balance-Operation mit ihren Effekten um. */
export function claimedToPaymentRecord(op, publicKey, effects = []) {
  const claimant = op?.claimant || op?.source_account;
  if (op?.type !== 'claim_claimable_balance' || claimant !== publicKey) return null;
  const claimed = effects.find((e) => e?.type === 'claimable_balance_claimed');
  if (!claimed) return null;
  const sponsorship = effects.find((e) => e?.type === 'claimable_balance_sponsorship_removed');
  return {
    ...baseFields(op),
    from: String(sponsorship?.former_sponsor || ''),
    to: publicKey,
    amount: String(claimed.amount || ''),
    balance_id: String(op.balance_id || ''),
    ...assetFields(claimed.asset),
  };
}

/**
 * Laedt die letzten Operationen des Kontos und liefert Anlegen/Einloesen als Zahlungs-Datensaetze.
 * Fehler beim Nachladen der Effekte einer einzelnen Einloesung lassen nur diesen Eintrag weg.
 * @param {import('@stellar/stellar-sdk').Horizon.Server} server
 * @param {string} publicKey
 * @param {{ limit?: number }} [options]
 */
export async function loadClaimableActivity(server, publicKey, { limit = 50 } = {}) {
  if (!server || !publicKey) return [];
  const page = await server.operations().forAccount(publicKey).order('desc').limit(limit).join('transactions').call();
  const ops = Array.isArray(page?.records) ? page.records : [];
  const out = await Promise.all(ops.map(async (op) => {
    if (op?.type === 'create_claimable_balance') return createdToPaymentRecord(op, publicKey);
    if (op?.type === 'claim_claimable_balance' && (op.claimant || op.source_account) === publicKey) {
      try {
        const fx = await server.effects().forOperation(op.id).limit(20).call();
        return claimedToPaymentRecord(op, publicKey, Array.isArray(fx?.records) ? fx.records : []);
      } catch (err) {
        console.warn('[SKM] claim effects could not be loaded', op.id, err);
        return null;
      }
    }
    return null;
  }));
  return out.filter(Boolean);
}

function tokenOf(record) {
  try { return BigInt(String(record?.paging_token || record?.id || '0')); } catch { return 0n; }
}

function timeOf(record) {
  const ms = Date.parse(String(record?.created_at || ''));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Fuegt die Zahlungen (a, von Horizon schon neueste zuerst) und die Claimable-Eintraege (b)
 * zusammen: ohne doppelte ids, neueste zuerst nach created_at, bei Gleichstand nach paging_token.
 * Ohne Eintraege in b bleibt die Reihenfolge von a unveraendert.
 */
export function mergeActivityRecords(a = [], b = []) {
  const seen = new Set();
  const dedupe = (list) => list.filter((r) => {
    const key = String(r?.id || r?.paging_token || '');
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const first = dedupe(a);
  const extra = dedupe(b);
  if (extra.length === 0) return first;
  return [...first, ...extra].sort((x, y) => {
    const dt = timeOf(y) - timeOf(x);
    if (dt !== 0) return dt;
    const tx = tokenOf(x);
    const ty = tokenOf(y);
    if (tx === ty) return 0;
    return tx > ty ? -1 : 1;
  });
}
