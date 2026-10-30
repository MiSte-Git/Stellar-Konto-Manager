// Runden der Groupfund-Ansicht (reine Funktionen, keine Horizon-Aufrufe).
//
// Das G-Konto wird nach jeder Runde geleert. Bewertet wird pro Transaktion: Die
// nativen Abfluesse aller ihrer Operationen (payment, path_payment mit XLM-Quelle,
// create_account, account_merge) werden summiert. Ein Reset liegt nur vor, wenn
//   a) der Saldo vor der Transaktion ueber Mindestreserve plus Puffer liegt,
//   b) der Saldo danach hoechstens Mindestreserve plus Puffer betraegt und
//   c) der Abfluss mindestens RESET_MIN_DRAIN_PERCENT des verfuegbaren Saldos davor
//      ausmacht (Saldo davor minus Mindestreserve). Bei 90 % entscheidet ab
//      Verfuegbar >= 10 x Puffer faktisch b), weil b) dann den hoeheren Abfluss verlangt.
// Der Abfluss ist Saldo davor minus Saldo danach, auch andere native Abbuchungen derselben
// Transaktion zaehlen also mit (z. B. Soroban-Transfer, create_claimable_balance). Eine
// Transaktion ohne payment, path_payment, create_account oder account_merge bleibt aussen vor.
// Das Zielkonto spielt keine Rolle. a) und c) sind noetig, weil das Konto direkt nach
// einem Reset ohnehin nahe der Grenze liegt: Eine Rueckzahlung am Rundenanfang ist
// keine Leerung. Bei einer Leerung ueber mehrere Transaktionen zaehlt nur die jeweilige
// Transaktion: Erfuellt keine davon die Bedingungen allein (100 -> 8 -> 3 XLM), wird die
// Leerung nicht erkannt und muss manuell gesetzt werden.
//
// Horizon liefert keinen historischen Saldo. Er wird deshalb rueckwaerts aus dem
// aktuellen Saldo rekonstruiert, ueber account_credited/account_debited (native)
// und account_created. Bekannte Abweichungen:
// - Gebuehren erscheinen nicht als Effect. Der rekonstruierte Saldo liegt um die
//   seither gezahlten Gebuehren daneben; das deckt der Puffer ab.
// - Trades mit XLM ausserhalb eigener Path Payments und Liquidity-Pool-Ein- und
//   -Auszahlungen mit XLM aendern den Saldo ohne account_credited/debited. Sie werden
//   nicht gerechnet, sondern gemeldet (countUnsureEffects).
// - Die Mindestreserve stammt aus dem aktuellen Kontostand, auch fuer alte Runden.
//
// Reihenfolge und Grenzen laufen ueber die Operations-ID, nicht ueber Zeitstempel. Eine
// Grenze ist immer eine ganze Transaktion: Sie gehoert zu keiner Runde.
import { fromStroops, toStroops } from './liquidityPools.js';

export const DEFAULT_BUFFER_XLM = '5';
export const RESET_MIN_DRAIN_PERCENT = 90n;

const EFFECT_ID_RE = /^(\d+)-\d+$/;
const OPERATION_INDEX_BITS = 12n; // TOID: Ledger (32 Bit), Transaktion (20), Operation (12)

/** Operations-ID (Dezimal-String ohne fuehrende Nullen) eines Effects; '' wenn unbekannt. */
export function opIdOfEffect(effect) {
  const match = EFFECT_ID_RE.exec(String(effect?.id ?? effect?.paging_token ?? ''));
  return match ? BigInt(match[1]).toString() : '';
}

/** Schluessel der Transaktion zu einer Operations-ID. */
export function txKeyOfOp(opId) {
  return BigInt(opId) >> OPERATION_INDEX_BITS;
}

const compareDesc = (a, b) => {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left === right) return 0;
  return left > right ? -1 : 1;
};

/** Die oberen 32 Bit einer Operations-ID sind die Ledger-Nummer. */
function ledgerOfOp(opId) {
  return BigInt(opId) >> 32n;
}

/** Aenderung des nativen Saldos durch einen Effect, in Stroops. */
export function nativeDeltaOfEffect(effect, accountId) {
  if (effect?.account !== accountId) return 0n;
  if (effect.type === 'account_created') return toStroops(effect.starting_balance);
  if (effect.asset_type !== 'native') return 0n;
  if (effect.type === 'account_credited') return toStroops(effect.amount);
  if (effect.type === 'account_debited') return -toStroops(effect.amount);
  return 0n;
}

/**
 * Saldo vor und nach jeder Transaktion mit nativer Aenderung, rueckwaerts ab
 * currentStroops, dazu die nativen Abbuchungen je Operation. Effects nach snapshotLedger
 * sind im aktuellen Saldo noch nicht enthalten und bleiben aussen vor.
 * @returns {Map<bigint, { before: bigint, after: bigint, debits: Map<string, bigint> }>}
 */
export function reconstructTxBalances({ currentStroops, effects, accountId, snapshotLedger }) {
  const byTx = new Map();
  (effects || []).forEach((effect) => {
    const opId = opIdOfEffect(effect);
    if (!opId) return;
    if (snapshotLedger != null && ledgerOfOp(opId) > BigInt(snapshotLedger)) return;
    const delta = nativeDeltaOfEffect(effect, accountId);
    if (delta === 0n) return;
    const key = txKeyOfOp(opId);
    if (!byTx.has(key)) byTx.set(key, { delta: 0n, debits: new Map() });
    const tx = byTx.get(key);
    tx.delta += delta;
    if (delta < 0n) tx.debits.set(opId, (tx.debits.get(opId) || 0n) - delta);
  });
  const result = new Map();
  let balance = currentStroops;
  [...byTx.keys()].sort(compareDesc).forEach((key) => {
    const { delta, debits } = byTx.get(key);
    const after = balance;
    balance -= delta;
    result.set(key, { before: balance, after, debits });
  });
  return result;
}

/** Ausgehende Operation des Kontos (jedes Asset) oder null. Kandidat fuer eine manuelle Grenze. */
export function outgoingOf(record, accountId) {
  if (!record || record.transaction_successful === false) return null;
  const isSelf = (to) => to === accountId;
  switch (record.type) {
    case 'payment':
    case 'path_payment':
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive': {
      if (record.from !== accountId || isSelf(record.to)) return null;
      const isPath = record.type !== 'payment';
      return {
        to: record.to,
        amount: record.amount,
        code: record.asset_type === 'native' ? 'XLM' : record.asset_code,
        native: (isPath ? record.source_asset_type : record.asset_type) === 'native',
      };
    }
    case 'create_account':
      // Ein noch nicht aktiviertes Zielkonto wird per create_account geleert.
      if (record.funder !== accountId || isSelf(record.account)) return null;
      return { to: record.account, amount: record.starting_balance, code: 'XLM', native: true };
    case 'account_merge':
      if (record.account !== accountId) return null;
      return { to: record.into, amount: '', code: 'XLM', native: true };
    default:
      return null;
  }
}

// Transaktionen mit ausgehenden Operationen, neueste zuerst.
function outgoingTransactions(payments, accountId) {
  const txs = new Map();
  (payments || []).forEach((record) => {
    const outgoing = outgoingOf(record, accountId);
    if (!outgoing) return;
    const key = txKeyOfOp(record.id);
    if (!txs.has(key)) txs.set(key, { key, items: [] });
    txs.get(key).items.push({ record, outgoing });
  });
  return [...txs.values()];
}

const hasNativeOutflow = (tx) => tx.items.some((item) => item.outgoing.native);

// Massgeblich fuer Ziel und opId: die ausgehende Operation mit der groessten nativen
// Abbuchung, ohne nativen Abfluss die zuerst gesehene.
function primaryItem(tx, entry) {
  let best = tx.items[0];
  let bestDebit = -1n;
  tx.items.forEach((item) => {
    if (!item.outgoing.native) return;
    const debit = entry?.debits.get(String(item.record.id)) ?? 0n;
    if (debit > bestDebit) {
      best = item;
      bestDebit = debit;
    }
  });
  return best;
}

/** Abfluss einer Transaktion: Saldo davor minus Saldo danach, nie negativ. */
function outflowOf(entry) {
  const outflow = entry.before - entry.after;
  return outflow > 0n ? outflow : 0n;
}

/** Transaktionen mit Eingaengen an das Konto. */
function incomingTxKeys(payments, accountId) {
  const keys = new Set();
  (payments || []).forEach((record) => {
    if (record.transaction_successful === false) return;
    const paid = record.to === accountId && record.from !== accountId;
    const merged = record.type === 'account_merge' && record.into === accountId && record.account !== accountId;
    if (paid || merged) keys.add(txKeyOfOp(record.id));
  });
  return keys;
}

// Ohne geladene Effects sind Abfluss und Saldo unbekannt: '' statt 0.
function toBoundary(tx, entry, source, incomingKeys) {
  const { record, outgoing } = primaryItem(tx, entry);
  return {
    opId: String(record.id),
    txHash: record.transaction_hash || '',
    createdAt: record.created_at || '',
    to: outgoing.to || '',
    outflow: entry ? fromStroops(outflowOf(entry)) : '',
    balanceAfter: entry ? fromStroops(entry.after) : '',
    hasIncoming: !!incomingKeys?.has(tx.key),
    source,
  };
}

/** Aelteste geladene Operation, bis zu der beide Feeds reichen. '' = alles geladen, null = noch nichts. */
export function coveredFromOpId({ payments, effects, paymentsDone, effectsDone }) {
  const oldestPayment = paymentsDone ? '' : String(payments?.[payments.length - 1]?.id ?? '');
  const oldestEffect = effectsDone ? '' : opIdOfEffect(effects?.[effects.length - 1]);
  if (!paymentsDone && !oldestPayment) return null;
  if (!effectsDone && !oldestEffect) return null;
  if (!oldestPayment) return oldestEffect;
  if (!oldestEffect) return oldestPayment;
  return compareDesc(oldestPayment, oldestEffect) <= 0 ? oldestPayment : oldestEffect;
}

// Zeit der aeltesten gescannten Stelle: der Feed, der weniger weit zurueckreicht, zaehlt.
function coveredTime({ payments, effects, paymentsDone, effectsDone }) {
  const oldestPayment = paymentsDone ? '' : payments?.[payments.length - 1]?.created_at || '';
  const oldestEffect = effectsDone ? '' : effects?.[effects.length - 1]?.created_at || '';
  return oldestPayment > oldestEffect ? oldestPayment : oldestEffect;
}

// Die Transaktion an der Grenze kann ueber zwei Seiten verteilt sein. Sie gilt erst als
// abgedeckt, wenn der Scan aelter ist; so fehlen weder Operationen noch Effects.
function isCovered(opId, coveredFrom) {
  if (coveredFrom === null) return false;
  return coveredFrom === '' || txKeyOfOp(opId) > txKeyOfOp(coveredFrom);
}

/** Die Reset-Bedingungen a) bis c), siehe Dateikopf. */
export function isResetTransaction({ before, after, reserveStroops, bufferStroops }) {
  const threshold = reserveStroops + bufferStroops;
  if (before <= threshold || after > threshold) return false;
  return (before - after) * 100n >= (before - reserveStroops) * RESET_MIN_DRAIN_PERCENT;
}

/** Erkannte Resets, neueste zuerst. */
export function detectResets({ payments, balances, reserveStroops, bufferStroops, accountId, coveredFrom }) {
  const incomingKeys = incomingTxKeys(payments, accountId);
  return outgoingTransactions(payments, accountId)
    .filter((tx) => hasNativeOutflow(tx) && isCovered(tx.items[0].record.id, coveredFrom))
    .filter((tx) => {
      const entry = balances.get(tx.key);
      return !!entry && isResetTransaction({ before: entry.before, after: entry.after, reserveStroops, bufferStroops });
    })
    .map((tx) => toBoundary(tx, balances.get(tx.key), 'detected', incomingKeys));
}

/** Wendet die Korrekturen an: verworfene Grenzen raus, manuelle dazu, neueste zuerst. */
export function applyBoundaryCorrections({ detected, dismissed, manual, coveredFrom }) {
  const removed = new Set(dismissed || []);
  const byTx = new Map();
  (detected || []).filter((b) => !removed.has(b.opId)).forEach((b) => byTx.set(txKeyOfOp(b.opId), b));
  (manual || []).filter((b) => isCovered(b.opId, coveredFrom)).forEach((b) => byTx.set(txKeyOfOp(b.opId), { ...b, source: 'manual' }));
  return [...byTx.values()].sort((a, b) => compareDesc(a.opId, b.opId));
}

/**
 * Runden aus den Grenzen, neueste zuerst. Index 0 ist die aktuelle Runde. Die aelteste
 * Runde hat keine Startgrenze: Sie gilt als vollstaendig, wenn die Historie zu Ende
 * gescannt ist (historyEnd).
 */
export function buildRounds(boundaries, { complete }) {
  const rounds = [];
  let end = null;
  (boundaries || []).forEach((start) => {
    rounds.push({ id: start.opId, start, end, complete: true, historyEnd: false });
    end = start;
  });
  rounds.push({ id: end ? `before-${end.opId}` : 'all', start: null, end, complete: !!complete, historyEnd: !!complete });
  return rounds;
}

/** Runde fuer einen manuellen Datumsbereich (from inklusive, to exklusiv, UTC-ISO ohne ms). */
export function buildDateRangeRound({ fromISO, toISO, coveredAt, complete }) {
  return {
    id: 'range',
    start: null,
    end: null,
    fromISO: fromISO || '',
    toISO: toISO || '',
    complete: !!complete || (!!fromISO && !!coveredAt && coveredAt < fromISO),
    historyEnd: false,
  };
}

/** Liegt der Payments-Datensatz in der Runde? Die Transaktion einer Grenze gehoert zu keiner. */
export function isRecordInRound(record, round) {
  if (!round) return false;
  if (round.id === 'range') {
    const created = record?.created_at || '';
    return (!round.fromISO || created >= round.fromISO) && (!round.toISO || created < round.toISO);
  }
  const txKey = txKeyOfOp(record.id);
  if (round.start && txKey <= txKeyOfOp(round.start.opId)) return false;
  return !(round.end && txKey >= txKeyOfOp(round.end.opId));
}

const hasNativeReserve = (reserves) => (reserves || []).some((reserve) => reserve?.asset === 'native');

/**
 * Effects, die den nativen Saldo aendern, ohne account_credited/debited zu erzeugen
 * (gegen den Horizon-Effects-Processor geprueft). Nicht gemeldet, weil keine Luecke:
 * claimable_balance_claimed und _created (parallel account_credited/debited),
 * contract_credited/debited (haengen am Op-Quellkonto, gemeint ist der Contract),
 * liquidity_pool_trade (gehoert zu einer Path Payment mit account_debited) und Trades
 * eigener Path Payments.
 */
export function countUnsureEffects(effects, payments, accountId) {
  const ownOutgoingOps = new Set((payments || []).filter((record) => record.from === accountId).map((record) => String(record.id)));
  return (effects || []).filter((effect) => {
    if (effect?.type === 'trade') {
      const native = effect.sold_asset_type === 'native' || effect.bought_asset_type === 'native';
      return native && !ownOutgoingOps.has(opIdOfEffect(effect));
    }
    if (effect?.type === 'liquidity_pool_deposited') return hasNativeReserve(effect.reserves_deposited);
    if (effect?.type === 'liquidity_pool_withdrew') return hasNativeReserve(effect.reserves_received);
    return false;
  }).length;
}

/**
 * Gesamtauswertung eines Scan-Stands.
 * @param {{ payments: object[], effects: object[], paymentsDone: boolean, effectsDone: boolean,
 *   currentStroops: bigint, snapshotLedger?: number|string, reserveStroops: bigint, bufferStroops: bigint,
 *   accountId: string, dismissed?: string[], manual?: object[] }} input
 */
export function analyzeRounds(input) {
  const { payments, effects, paymentsDone, effectsDone, currentStroops, snapshotLedger, reserveStroops, bufferStroops, accountId, dismissed, manual } = input;
  const coveredFrom = coveredFromOpId({ payments, effects, paymentsDone, effectsDone });
  const complete = !!paymentsDone && !!effectsDone;
  const balances = reconstructTxBalances({ currentStroops, effects, accountId, snapshotLedger });
  const detected = detectResets({ payments, balances, reserveStroops, bufferStroops, accountId, coveredFrom });
  const boundaries = applyBoundaryCorrections({ detected, dismissed, manual, coveredFrom });
  const incomingKeys = incomingTxKeys(payments, accountId);
  const candidates = outgoingTransactions(payments, accountId)
    .filter((tx) => isCovered(tx.items[0].record.id, coveredFrom))
    .map((tx) => {
      // Nur eine reine Token-Zahlung nennt ihren eigenen Betrag, sonst zaehlt der XLM-Abfluss.
      const tokenOnly = !hasNativeOutflow(tx);
      return {
        ...toBoundary(tx, balances.get(tx.key), 'candidate', incomingKeys),
        tokenAmount: tokenOnly ? `${tx.items[0].outgoing.amount} ${tx.items[0].outgoing.code}` : '',
      };
    });
  return {
    coveredFrom,
    coveredAt: coveredTime({ payments, effects, paymentsDone, effectsDone }),
    complete,
    detected,
    boundaries,
    rounds: buildRounds(boundaries, { complete }),
    candidates,
    unsureEffects: countUnsureEffects(effects, payments, accountId),
  };
}
