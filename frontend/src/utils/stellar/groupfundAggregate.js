// Aggregation der Groupfund-Ansicht (reine Funktionen, keine Horizon-Aufrufe).
// Alle Betraege als Stroop-BigInt. Eine M-Adresse hat keinen Saldo: Die Werte hier
// sind Summen aus der Historie, kein Guthaben.
//
// from/to sind in Horizon immer die G-Adresse; die Muxed-ID steht in *_muxed_id als
// String (uint64, deshalb nie als Number vergleichen).
import { shortenKey } from '../../components/trading/assetSearchUtils.js';
import { isDustAmount } from './activity.js';
import { fromStroops, toStroops } from './liquidityPools.js';
import { cleanMemo } from './queryUtils.js';
import { isRecordInRound, nativeDeltaOfEffect, opIdOfEffect } from './groupfundRounds.js';

const PAYMENT_TYPES = new Set(['payment', 'path_payment', 'path_payment_strict_send', 'path_payment_strict_receive']);

function assetOfRecord(record) {
  if (!record?.asset_type || record.asset_type === 'native') return { code: 'XLM', issuer: '', isNative: true };
  return { code: String(record.asset_code || ''), issuer: String(record.asset_issuer || ''), isNative: false };
}

/** Einheit fuer die Anzeige: Nur natives XLM heisst XLM, Tokens immer mit Issuer. */
export function assetUnitLabel(asset) {
  return asset.isNative ? 'XLM' : `${asset.code} (${shortenKey(asset.issuer)})`;
}

const assetKey = (asset) => (asset.isNative ? 'native' : `${asset.code}:${asset.issuer}`);

/** Betrag eingehender account_merge-Operationen: steht nur im Effect, nicht im Datensatz. */
export function mergeCreditsFromEffects(effects, accountId) {
  const credits = new Map();
  (effects || []).forEach((effect) => {
    if (effect?.type !== 'account_credited') return;
    const delta = nativeDeltaOfEffect(effect, accountId);
    const opId = opIdOfEffect(effect);
    if (opId && delta > 0n) credits.set(opId, (credits.get(opId) || 0n) + delta);
  });
  return credits;
}

// Das SDK macht aus transaction eine Lazy-Funktion, die Join-Daten liegen in transaction_attr.
function joinedTx(record) {
  if (record?.transaction_attr) return record.transaction_attr;
  return record?.transaction && typeof record.transaction === 'object' ? record.transaction : null;
}

const memoOf = (record) => cleanMemo(joinedTx(record)?.memo ?? '');

function matcherFor(identifier) {
  if (identifier?.mode === 'memo') {
    const wanted = cleanMemo(identifier.memo);
    const matches = (record) => !!wanted && memoOf(record) === wanted;
    return { incoming: matches, outgoing: matches, unmarked: (record) => !memoOf(record) };
  }
  const id = String(identifier?.id ?? '');
  return {
    incoming: (record) => !!id && String(record.to_muxed_id ?? record.into_muxed_id ?? '') === id,
    outgoing: (record) => !!id && String(record.from_muxed_id ?? '') === id,
    unmarked: (record) => record.from_muxed_id === undefined || record.from_muxed_id === null,
  };
}

// Eingang an das Konto: { sender, amount, asset } oder null. amount ist null, wenn der
// Betrag unbekannt ist: account_merge ohne geladenen Credit-Effect.
function incomingOf(record, accountId, mergeCredits) {
  if (PAYMENT_TYPES.has(record.type)) {
    if (record.to !== accountId || record.from === accountId) return null;
    return { sender: record.from, amount: toStroops(record.amount), asset: assetOfRecord(record) };
  }
  if (record.type === 'account_merge') {
    if (record.into !== accountId || record.account === accountId) return null;
    return { sender: record.account, amount: mergeCredits.get(String(record.id)) ?? null, asset: assetOfRecord(null) };
  }
  return null;
}

// Ausgang an einen Absender. Massgeblich ist, was dort ankommt: amount und asset_* gelten
// bei Path Payments fuer die Zielseite.
function outgoingOf(record, accountId) {
  if (!PAYMENT_TYPES.has(record.type) || record.from !== accountId || record.to === accountId) return null;
  return { to: record.to, amount: toStroops(record.amount), asset: assetOfRecord(record) };
}

function rowFor(rows, sender, asset) {
  const key = `${sender}|${assetKey(asset)}`;
  if (!rows.has(key)) {
    rows.set(key, { key, sender, asset, gross: 0n, refunds: 0n, net: 0n, unmarkedOut: 0n, count: 0, dustCount: 0, amountUnknown: false, firstAt: '', lastAt: '', txHashes: [] });
  }
  return rows.get(key);
}

function addHash(row, record) {
  if (record.transaction_hash && !row.txHashes.includes(record.transaction_hash)) row.txHashes.push(record.transaction_hash);
}

// Erste und letzte Zahlung beziehen sich nur auf Eingaenge.
function addIncomingDates(row, record) {
  const created = record.created_at || '';
  if (created && (!row.firstAt || created < row.firstAt)) row.firstAt = created;
  if (created && (!row.lastAt || created > row.lastAt)) row.lastAt = created;
}

/**
 * Zeilen pro Absender und Asset fuer eine Runde.
 * refunds: Ausgaenge mit Kennzeichen an diesen Absender, gehen ins Netto ein.
 * unmarkedOut: Ausgaenge ohne Kennzeichen an diesen Absender, werden NICHT verrechnet.
 * amountUnknown: Die Zeile enthaelt einen Eingang ohne bekannten Betrag; Brutto und Netto sind dann zu niedrig.
 * @returns {{ rows: object[], totals: object[], accountCreatedInRound: boolean, memoJoinMissing: number, amountUnknownCount: number }}
 */
export function aggregateRound({ payments, effects, accountId, identifier, round }) {
  const mergeCredits = mergeCreditsFromEffects(effects, accountId);
  const match = matcherFor(identifier);
  const inRound = (payments || []).filter((record) => record.transaction_successful !== false && isRecordInRound(record, round));
  const rows = new Map();
  const senders = new Set();
  let memoJoinMissing = 0;
  let amountUnknownCount = 0;

  inRound.forEach((record) => {
    if (identifier?.mode === 'memo' && !joinedTx(record)) memoJoinMissing += 1;
    const incoming = incomingOf(record, accountId, mergeCredits);
    if (!incoming || !match.incoming(record)) return;
    const row = rowFor(rows, incoming.sender, incoming.asset);
    if (incoming.amount === null) {
      row.amountUnknown = true;
      amountUnknownCount += 1;
    } else {
      row.gross += incoming.amount;
      if (isDustAmount(incoming.asset, fromStroops(incoming.amount))) row.dustCount += 1;
    }
    row.count += 1;
    addIncomingDates(row, record);
    addHash(row, record);
    senders.add(incoming.sender);
  });

  inRound.forEach((record) => {
    const outgoing = outgoingOf(record, accountId);
    if (!outgoing || !senders.has(outgoing.to)) return;
    if (match.outgoing(record)) {
      const row = rowFor(rows, outgoing.to, outgoing.asset);
      row.refunds += outgoing.amount;
      addHash(row, record);
    } else if (match.unmarked(record)) {
      rowFor(rows, outgoing.to, outgoing.asset).unmarkedOut += outgoing.amount;
    }
  });

  const list = [...rows.values()].map((row) => ({ ...row, net: row.gross - row.refunds }));
  list.sort((a, b) => {
    if (a.asset.isNative !== b.asset.isNative) return a.asset.isNative ? -1 : 1;
    if (a.gross === b.gross) return a.key < b.key ? -1 : 1;
    return a.gross > b.gross ? -1 : 1;
  });

  const totals = new Map();
  list.forEach((row) => {
    const key = assetKey(row.asset);
    if (!totals.has(key)) totals.set(key, { key, asset: row.asset, gross: 0n, refunds: 0n, net: 0n, unmarkedOut: 0n, count: 0, senders: 0, amountUnknown: false });
    const total = totals.get(key);
    total.gross += row.gross;
    total.refunds += row.refunds;
    total.net += row.net;
    total.unmarkedOut += row.unmarkedOut;
    total.count += row.count;
    if (row.count > 0) total.senders += 1;
    if (row.amountUnknown) total.amountUnknown = true;
  });

  const accountCreatedInRound = inRound.some((record) => record.type === 'create_account' && record.account === accountId);
  return { rows: list, totals: [...totals.values()], accountCreatedInRound, memoJoinMissing, amountUnknownCount };
}

/** Eintraege fuer findLookalikeCounterparties: alle Ein- und Ausgaenge der Runde mit Gegenpartei. */
export function counterpartiesOfRound({ payments, accountId, round }) {
  return (payments || [])
    .filter((record) => PAYMENT_TYPES.has(record.type) && isRecordInRound(record, round))
    .map((record) => {
      if (record.to === accountId && record.from !== accountId) return { direction: 'in', counterparty: record.from };
      if (record.from === accountId && record.to !== accountId) return { direction: 'out', counterparty: record.to };
      return null;
    })
    .filter(Boolean);
}
