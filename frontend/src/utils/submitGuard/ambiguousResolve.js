// Aufloesen eines unklaren Sendestatus ueber Horizon (gemeinsam fuer Sammelzahlung und
// "Zahlung senden", vorbereitet fuer weitere Sendewege wie das Trading).
//
// Ein Senden ist "unklar", wenn submitTransaction ohne eindeutige Antwort endet
// (Netzfehler, Zeitueberschreitung, 5xx) und die Nachfrage den Hash nicht gefunden hat.
// Freigegeben wird nur ueber Horizon-Daten: Die Transaktion ist im Ledger (angewendet oder
// fehlgeschlagen) oder sie kann laut Ledger-Zeit (closed_at) nicht mehr angewendet werden.
// Die lokale Uhr entscheidet nie allein.
import { Account } from '@stellar/stellar-sdk';

// Sicherheitsabstand zwischen maxTime und dem letzten bekannten Ledger, falls Horizon
// hinter einem Load-Balancer laeuft und die Knoten unterschiedlich weit sind.
export const AMBIGUOUS_LEDGER_BUFFER_SECONDS = 60;

/**
 * Zeitpunkt (ms, lokale Uhr), ab dem resolveAmbiguous fruehestens 'expired' liefern kann:
 * maxTime der Transaktion plus Puffer. Massgeblich bleibt der Ledger-Zeitstempel von
 * Horizon; die Angabe ist fuer die Anzeige und die automatische Pruefung. null ohne maxTime.
 */
export function ambiguousClearAt(entry) {
  const maxTime = Number(entry?.maxTime);
  return Number.isInteger(maxTime) && maxTime > 0 ? (maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS) * 1000 : null;
}

// Mindestabstand der zwei Abfragen, bevor ein Eintrag mit verbrauchter (oder unbekannter)
// Sequence als abgelaufen gilt. Ein hinkender Horizon-Knoten oder ein Cache soll den
// Hash nicht zweimal kurz hintereinander als "nicht gefunden" melden koennen.
export const AMBIGUOUS_STRICT_RECHECK_MS = 30 * 1000;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wirft einen AbortError, wenn das Signal abgebrochen ist (Abbruch durch die Nutzerin). */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

// Wartezeit, die ein Abbruch sofort beendet (AbortError).
function abortableSleep(ms, signal) {
  if (!signal) return sleepMs(ms);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const done = () => { signal.removeEventListener('abort', onAbort); resolve(); };
    const timer = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Sequence eines Kontos (AccountResponse oder Account des SDK) als BigInt oder null.
export function accountSequenceOf(account) {
  try {
    const raw = typeof account?.sequenceNumber === 'function' ? account.sequenceNumber() : account?.sequence;
    return /^\d+$/.test(String(raw ?? '')) ? BigInt(String(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Gehoert ein Horizon-Transaktionsdatensatz zu diesem Hash? Direkt (hash) oder als innere
 * Transaktion einer Fee-Bump-Transaktion (inner_transaction.hash): Horizon liefert unter
 * dem inneren Hash den Fee-Bump-Datensatz mit dessen eigenem Hash.
 */
export function recordMatchesHash(record, hash) {
  const want = String(hash || '').toLowerCase();
  if (!want) return false;
  if (String(record?.hash || record?.id || '').toLowerCase() === want) return true;
  return String(record?.inner_transaction?.hash || '').toLowerCase() === want;
}

/**
 * Hash der Fee-Bump-Transaktion, wenn der Datensatz unsere Transaktion (hash) als innere
 * Transaktion enthaelt, sonst ''. Horizon liefert je nach abgefragtem Hash oben den inneren
 * oder den aeusseren Hash; das Objekt fee_bump_transaction enthaelt immer den aeusseren.
 */
export function feeBumpHashOf(record, hash) {
  const lower = (v) => String(v || '').toLowerCase();
  const want = lower(hash);
  if (!want) return '';
  const fee = lower(record?.fee_bump_transaction?.hash);
  if (fee && fee !== want) return fee;
  const top = lower(record?.hash || record?.id);
  if (lower(record?.inner_transaction?.hash) === want && top && top !== want) return top;
  return '';
}

/**
 * Sucht einen Hash bei Horizon. Ein Treffer zaehlt nur, wenn der Hash der Antwort dem
 * gesuchten entspricht (auch als innere Transaktion eines Fee-Bumps): 'success'
 * (successful true), 'failed' (successful false), 'notFound' (404) oder 'unknown'
 * (Netzfehler, anderer Status, Antwort ohne passenden Hash oder ohne eindeutiges successful).
 */
export async function lookupTransaction(server, hash) {
  try {
    const record = await server.transactions().transaction(hash).call();
    if (!recordMatchesHash(record, hash)) return 'unknown';
    if (record.successful === true) return 'success';
    if (record.successful === false) return 'failed';
    return 'unknown';
  } catch (e) {
    return e?.response?.status === 404 ? 'notFound' : 'unknown';
  }
}

// Alle Hashes eines Eintrags (aktueller zuerst, dann fruehere Versuche).
function entryHashes(entry) {
  return [entry.hash, ...(Array.isArray(entry.prev) ? entry.prev : [])].filter(Boolean);
}

/**
 * Sucht alle Hashes eines Eintrags: { result, hash }. Erfolgreich gefunden gewinnt; sonst
 * 'unknown', wenn eine Abfrage nicht eindeutig war; sonst 'failed' fuer den aktuellen Hash;
 * sonst 'notFound'. Eine fruehere, fehlgeschlagene Transaktion entscheidet nichts.
 */
async function lookupEntry(server, entry) {
  let unknown = false;
  let failed = false;
  for (const hash of entryHashes(entry)) {
    const r = await lookupTransaction(server, hash);
    if (r === 'success') return { result: 'success', hash };
    if (r === 'unknown') unknown = true;
    if (r === 'failed' && hash === entry.hash) failed = true;
  }
  if (unknown) return { result: 'unknown', hash: entry.hash };
  if (failed) return { result: 'failed', hash: entry.hash };
  return { result: 'notFound', hash: entry.hash };
}

async function latestClosedSeconds(server) {
  try {
    const ledgers = await server.ledgers().order('desc').limit(1).call();
    return Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
  } catch {
    return NaN;
  }
}

/**
 * Loest einen unklaren Eintrag ueber Horizon auf. Ergebnis { outcome, hash }:
 * - 'success' (im Ledger erfolgreich; hash = gefundener Hash, auch ein frueherer Versuch)
 * - 'failed' (im Ledger fehlgeschlagen)
 * - 'expiredPinned' (nicht im Ledger, abgelaufen, die Sequence ist laut Horizon genau die
 *   naechste freie: erneut senden nur mit genau dieser Sequence, dann kann das Netz
 *   hoechstens eine der beiden Transaktionen ausfuehren, auch wenn Horizon hinkt)
 * - 'expired' (nicht im Ledger, abgelaufen, Sequence verbraucht, unbekannt oder weit vor
 *   der Konto-Sequence (z.B. nach einem Testnet-Reset): nur nach zwei Abfragen im Abstand
 *   von mindestens AMBIGUOUS_STRICT_RECHECK_MS, die beide den Hash nicht finden und beide
 *   einen Ledger nach maxTime plus Puffer melden)
 * - 'pending' (nicht im Ledger, laut letztem Ledger noch gueltig oder im Puffer)
 * - 'unknown' (Horizon nicht erreichbar oder nicht eindeutig, Eintrag ohne maxTime
 *   (auch maxTime <= 0) oder unlesbar)
 *
 * "Abgelaufen" haengt nicht an der Client-Uhr, sondern an closed_at des letzten Ledgers.
 *
 * signal (optional): Bricht die Nutzerin ab, wirft die Funktion einen AbortError (auch mitten
 * in einer Wartezeit) und liefert kein Ergebnis; der Eintrag wird dann nicht angefasst.
 */
export async function resolveAmbiguousDetailed({
  server, entry, retryDelayMs = 2000, strictDelayMs = AMBIGUOUS_STRICT_RECHECK_MS, sleep: sleepIn = null, signal = null,
}) {
  const sleep = sleepIn || ((ms) => abortableSleep(ms, signal));
  throwIfAborted(signal);
  if (!entry?.hash || entry.unreadable) return { outcome: 'unknown', hash: entry?.hash || '' };
  const maxTime = Number(entry.maxTime);
  const hasMaxTime = Number.isInteger(maxTime) && maxTime > 0;
  const pastValidity = (closed) => Number.isFinite(closed) && closed > maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
  const found = (r) => ({ outcome: r.result, hash: r.hash });

  if (!hasMaxTime) {
    const r = await lookupEntry(server, entry);
    return r.result === 'notFound' ? { outcome: 'unknown', hash: entry.hash } : found(r);
  }

  const closed1 = await latestClosedSeconds(server);
  throwIfAborted(signal);
  let r = await lookupEntry(server, entry);
  throwIfAborted(signal);
  if (r.result !== 'notFound') return found(r);
  if (!pastValidity(closed1)) return { outcome: Number.isFinite(closed1) ? 'pending' : 'unknown', hash: entry.hash };

  // Ist die Sequence der Transaktion die naechste freie? Dann ist sie nicht angewendet
  // worden (oder Horizon hinkt). Eine neue Transaktion mit derselben Sequence schliesst
  // eine Doppelzahlung in beiden Faellen aus. Liegt die Konto-Sequence weiter darunter
  // (z.B. Testnet-Reset), wuerde ein Pin dauerhaft mit tx_bad_seq scheitern: dann der
  // strenge Pfad unten.
  if (entry.seq && entry.source) {
    let accountSeq = null;
    try {
      accountSeq = accountSequenceOf(await server.loadAccount(entry.source));
    } catch (e) {
      if (e?.response?.status !== 404) return { outcome: 'unknown', hash: entry.hash };
    }
    throwIfAborted(signal);
    if (accountSeq !== null && accountSeq === BigInt(entry.seq) - 1n) {
      await sleep(retryDelayMs);
      r = await lookupEntry(server, entry);
      throwIfAborted(signal);
      return r.result === 'notFound' ? { outcome: 'expiredPinned', hash: entry.hash } : found(r);
    }
  }

  // Sequence verbraucht (andere Zahlungen dieses Kontos seitdem, oder die Transaktion
  // selbst), nicht direkt verwendbar oder unbekannt: nur nach einer zweiten Abfrage mit Abstand.
  await sleep(strictDelayMs);
  r = await lookupEntry(server, entry);
  if (r.result !== 'notFound') { throwIfAborted(signal); return found(r); }
  const closed2 = await latestClosedSeconds(server);
  throwIfAborted(signal);
  if (!pastValidity(closed2)) return { outcome: Number.isFinite(closed2) ? 'pending' : 'unknown', hash: entry.hash };
  return { outcome: 'expired', hash: entry.hash };
}

/** Wie resolveAmbiguousDetailed, liefert nur das Ergebnis (String). */
export async function resolveAmbiguous(args) {
  return (await resolveAmbiguousDetailed(args)).outcome;
}

/**
 * Loest einen gespeicherten unklaren Eintrag auf und schreibt das Ergebnis zurueck.
 * read(): aktueller Eintrag frisch aus dem Speicher, write(entry): schreibt ihn.
 * Nur der eben gepruefte Eintrag wird geaendert: Ein anderer Tab kann inzwischen einen
 * neuen Eintrag geschrieben (oder diesen schon aufgeloest) haben.
 * - success: { hash (gefundener), at, status 'success', maxTime, seq, source, ...extra(entry) }
 * - failed / expired / expiredPinned: { ...entry, status 'notApplied', pin (nur expiredPinned) }
 * - pending / unknown: Eintrag bleibt unklar.
 * Ergebnis { entry, outcome } mit outcome success | failed | expired | pending | unknown
 * (expiredPinned als expired) oder null, wenn nichts aufzuloesen war.
 * cache (Map Hash -> Ergebnis): denselben Hash nur einmal bei Horizon pruefen.
 * onConsumed(entry): die Transaktion dieses Eintrags (genau dieser Hash, also diese Sequence)
 * steht im Ledger, erfolgreich oder fehlgeschlagen; ihre Sequence ist verbraucht.
 * signal (optional): Abbruch durch die Nutzerin. Dann wirft die Funktion einen AbortError und
 * schreibt nichts; der Eintrag bleibt unklar und sperrt weiter (fail-closed).
 */
export async function settleAmbiguousEntry({
  server, read, write, cache = null, extra = () => ({}), resolve = resolveAmbiguousDetailed, onConsumed = null, signal = null,
}) {
  let entry = read();
  if (entry?.status !== 'ambiguous' || entry.unreadable) return { entry, outcome: null };
  let res = cache?.get(entry.hash);
  if (!res) {
    res = await resolve({ server, entry, signal });
    cache?.set(entry.hash, res);
  }
  throwIfAborted(signal);
  const current = read();
  if (current?.hash !== entry.hash || current.status !== 'ambiguous') return { entry: current, outcome: null };
  const { outcome } = res;
  const original = entry;
  if (outcome === 'success') {
    entry = { ...extra(entry), hash: res.hash || entry.hash, at: entry.at, status: 'success', maxTime: entry.maxTime, seq: entry.seq, source: entry.source };
    write(entry);
    if (entry.hash === original.hash) onConsumed?.(original);
  } else if (outcome === 'failed' || outcome === 'expired' || outcome === 'expiredPinned') {
    const { recheck: _r, ...rest } = entry;
    // settledAt: Beginn der 30 Tage Aufbewahrung (ab Klaerung bzw. Vergabe des Pins, nicht ab Senden).
    entry = { ...rest, status: 'notApplied', pin: outcome === 'expiredPinned', settledAt: Date.now() };
    write(entry);
    if (outcome === 'failed') onConsumed?.(original);
  }
  return { entry, outcome: outcome === 'expiredPinned' ? 'expired' : outcome };
}

/**
 * Konto fuer eine neue Transaktion von einem Konto mit offenem Pin. Gleiche Bedingung wie
 * beim Vergeben des Pins (resolveAmbiguousDetailed): Die aktuelle Sequence des Kontos muss
 * genau pinSeq - 1 sein, dann bekommt die neue Transaktion genau pinSeq.
 * { account, pinned } oder { consumed: true } (Sequence erreicht oder ueberschritten) bzw.
 * { consumed: true, behind: true } (Konto-Sequence weiter darunter, z.B. hinkender
 * Horizon-Knoten oder Testnet-Reset). In beiden Faellen nicht senden, strenger Pfad.
 */
export function pinnedSendAccount({ account, source, pinSeq }) {
  const current = accountSequenceOf(account);
  const pin = BigInt(pinSeq);
  if (current === null || current >= pin) return { consumed: true };
  if (current !== pin - 1n) return { consumed: true, behind: true };
  return { account: new Account(String(source).trim(), (pin - 1n).toString()), pinned: true };
}

/** Hat das Netz die Transaktion wegen der Sequence abgelehnt (tx_bad_seq)? */
export function isBadSeqError(err) {
  return err?.response?.data?.extras?.result_codes?.transaction === 'tx_bad_seq';
}

/**
 * Sucht mehrere Hashes (fruehere Versuche einer Zahlung) einige Male. 'success' mit dem
 * gefundenen Hash, sonst 'notFound' oder 'unknown'.
 */
export async function findAnyTransaction({ server, hashes, attempts = 3, delayMs = 1500, sleep = sleepMs }) {
  let last = 'notFound';
  for (let i = 0; i < attempts; i += 1) {
    last = 'notFound';
    for (const hash of hashes) {
      const r = await lookupTransaction(server, hash);
      if (r === 'success') return { result: 'success', hash };
      if (r === 'unknown') last = 'unknown';
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { result: last, hash: '' };
}

/**
 * Ursache eines unklaren Submits fuer die Anzeige: 'network' (keine Antwort, z.B. Failed to
 * fetch), 'timeout' (Zeitueberschreitung des Clients oder HTTP 408/504) oder 'server'
 * (andere HTTP-Antwort ohne Ergebnis, z.B. 500/502/503/429). status: HTTP-Status oder null.
 */
export function classifySubmitCause(err) {
  const status = Number(err?.response?.status) || null;
  const code = String(err?.code || '');
  const text = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
  if (status === 408 || status === 504) return { kind: 'timeout', status };
  if (status) return { kind: 'server', status };
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout|timed out|aborted/.test(text)) return { kind: 'timeout', status: null };
  return { kind: 'network', status: null };
}
