// Horizon-Scan der Groupfund-Ansicht. Horizon filtert weder nach Muxed-ID noch nach
// Datum: payments (mit Memo per join) und effects werden absteigend paginiert und
// clientseitig ausgewertet. Der Stand bleibt nur im Sitzungsspeicher.
//
// Beide Feeds laufen gleichauf: Es wird jeweils der Feed nachgeladen, der noch nicht so
// weit zurueckreicht. Effects liefern den historischen Saldo und die Betraege von
// account_merge, die payments-Datensaetze haben dafuer kein Feld.
//
// Ein Feed-Abruf laesst sich nicht abbrechen. Laeufe warten deshalb nicht aufeinander (eine
// haengende Anfrage wuerde sonst alles blockieren), sondern pruefen nach jeder Antwort:
// Ist der eigene Lauf abgebrochen, endet er. Ist die Seite schon uebernommen, wird die
// Antwort uebergangen und der Lauf geht weiter. Beides verhindert doppelte Seiten, die die
// Summen zu hoch machen wuerden.
import { toStroops } from './liquidityPools.js';
import { withRetry } from './queryUtils.js';
import { opIdOfEffect } from './groupfundRounds.js';

const PAGE_LIMIT = 200;

export function createScanState(accountId) {
  return {
    accountId,
    account: null,
    currentStroops: 0n,
    snapshotLedger: null,
    payments: [],
    effects: [],
    paymentsDone: false,
    effectsDone: false,
    paymentsPage: null,
    effectsPage: null,
    pages: 0,
    scannedAt: '',
  };
}

const abortedError = () => Object.assign(new Error('groupfund.aborted'), { isAborted: true });

/** Laedt den aktuellen Saldo, Basis der Rekonstruktion. Vor dem ersten Feed-Abruf aufrufen. */
export async function loadScanAccount(scan, server, signal) {
  const account = await withRetry(() => server.loadAccount(scan.accountId), { signal });
  if (signal?.aborted) throw abortedError();
  const native = (account?.balances || []).find((b) => b.asset_type === 'native');
  scan.account = account;
  scan.currentStroops = toStroops(native?.balance ?? '0');
  scan.snapshotLedger = account?.last_modified_ledger ?? null;
  scan.scannedAt = new Date().toISOString();
}

// Naechste Seite eines Feeds; next() traegt join und Reihenfolge in sich.
async function fetchNext(scan, server, feed, signal) {
  const pageKey = `${feed}Page`;
  const previous = scan[pageKey];
  const page = await withRetry(() => {
    if (previous) return previous.next();
    const builder = feed === 'payments'
      ? server.payments().forAccount(scan.accountId).order('desc').limit(PAGE_LIMIT).join('transactions')
      : server.effects().forAccount(scan.accountId).order('desc').limit(PAGE_LIMIT);
    return builder.call();
  }, { signal });
  if (signal?.aborted) throw abortedError();
  if (scan[pageKey] !== previous) return;
  const records = page?.records || [];
  scan[feed].push(...records);
  scan[pageKey] = page;
  scan.pages += 1;
  if (records.length < PAGE_LIMIT) scan[`${feed}Done`] = true;
}

function pickFeed(scan) {
  if (scan.paymentsDone) return scan.effectsDone ? null : 'effects';
  if (scan.effectsDone) return 'payments';
  const oldestPayment = scan.payments[scan.payments.length - 1]?.id;
  const oldestEffect = opIdOfEffect(scan.effects[scan.effects.length - 1]);
  if (!oldestPayment) return 'payments';
  if (!oldestEffect) return 'effects';
  return BigInt(oldestPayment) >= BigInt(oldestEffect) ? 'payments' : 'effects';
}

/** Laedt eine Seite. false, wenn beide Feeds zu Ende sind. */
export async function advanceScan(scan, server, signal) {
  const feed = pickFeed(scan);
  if (!feed) return false;
  await fetchNext(scan, server, feed, signal);
  return true;
}
