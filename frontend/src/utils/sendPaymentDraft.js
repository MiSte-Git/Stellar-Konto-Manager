// Entwurf des Formulars "Zahlung senden", nur im Arbeitsspeicher.
//
// SendPaymentPage wird beim Kontowechsel kurz ausgehaengt (Konto-Sperre, solange kein
// Konto geladen ist) und danach neu eingehaengt. Ohne diesen Speicher waeren Empfaenger,
// Betrag, Asset und Memo dann weg. Gewollt ist: Eingaben bleiben beim Kontowechsel
// erhalten, damit dieselbe Zahlung nacheinander von mehreren Konten gesendet werden kann.
//
// Bewusst kein localStorage/sessionStorage: Nach einem Neuladen der Seite ist der
// Entwurf weg, genau wie vorher. Es werden keine Secrets abgelegt.
//
// Schutz gegen ungewollte zweite Zahlung:
// - Der Entwurf gehoert zu einem Netz und wird in einem anderen Netz nicht geladen.
// - Sperren (Schloss, Inaktivitaets-Timeout) loescht ihn ueber clearAllSessionSecrets.
//   Eine bereits eingehaengte Seite schreibt danach nicht mehr in den Speicher
//   (Generation), ihr sichtbares Formular bleibt aber stehen.
// - Felder, die wie ein Secret Key aussehen, werden nicht uebernommen (auch autoFilledMemo und
//   die Werte von initial).
// - Gesendete Zahlungen werden je Konto vermerkt, damit die Seite beim gleichen Konto
//   mit gleichen Daten warnen kann (der Entwurf selbst bleibt fuer das naechste Konto).
import { containsSecretKey } from './batchPayment/batchPaymentStore.js';

const SENT_MAX = 20;
const SENT_WINDOW_MS = 20 * 60 * 60 * 1000;

// Nur Text und Zahlen koennen ein Secret tragen (Objekte, Booleans nicht).
const isSecretValue = (v) => (typeof v === 'string' || typeof v === 'number') && containsSecretKey(v);

let draft = null;
let generation = 0;
let sentPayments = [];

export function draftGeneration() {
  return generation;
}

// Ohne `network` kein Netzvergleich (nur fuer Tests und Altaufrufer).
export function readSendPaymentDraft(network) {
  if (!draft) return null;
  if (network !== undefined && draft.network !== network) return null;
  return draft;
}

// `gen`: Generation beim Einhaengen der Seite. Wurde seither gesperrt, wird nichts
// mehr geschrieben. Gibt zurueck, ob geschrieben wurde.
export function writeSendPaymentDraft(next, gen) {
  if (gen !== undefined && gen !== generation) return false;
  if (!next) {
    draft = null;
    return true;
  }
  const clean = { ...next };
  for (const field of ['dest', 'amount', 'memoVal']) {
    if (containsSecretKey(clean[field])) clean[field] = '';
  }
  // autoFilledMemo (aus der Federation-Aufloesung) und initial (Spenden-/Deep-Link) stammen nicht aus
  // einer Eingabe des Nutzers, bleiben aber im Speicher: gleiche Regel wie fuer die Felder.
  if (containsSecretKey(clean.autoFilledMemo)) clean.autoFilledMemo = '';
  if (clean.initial && typeof clean.initial === 'object' && Object.values(clean.initial).some(isSecretValue)) {
    // Nur dann eine Kopie: Sonst bleibt es dasselbe Objekt (die Seite wendet jedes initial einmal an
    // und erkennt es an der Identitaet).
    clean.initial = Object.fromEntries(Object.entries(clean.initial).map(([k, v]) => [k, isSecretValue(v) ? '' : v]));
  }
  draft = clean;
  return true;
}

export function clearSendPaymentDraft() {
  draft = null;
  sentPayments = [];
  generation += 1;
}

function sentKey(p) {
  const memoType = String(p?.memoType || 'none');
  return JSON.stringify([
    String(p?.network || ''),
    String(p?.account || ''),
    String(p?.dest || '').trim(),
    String(p?.amount || '').trim(),
    String(p?.assetKey || 'XLM'),
    memoType,
    memoType === 'none' ? '' : String(p?.memoVal || '').trim(),
  ]);
}

// status: 'success' | 'ambiguous'. Ein unklarer Vermerk folgt der Sperre pro Konto
// (utils/submitGuard/accountSendGuard.js): Nach der Klaerung ueber Horizon wird er auf
// success gesetzt (angewendet) oder entfernt (nicht ausgefuehrt).
export function recordSentPayment(payment, { hash = '', status = 'success', at = Date.now() } = {}) {
  const key = sentKey(payment);
  sentPayments = [{ key, hash, status, at }, ...sentPayments.filter((e) => e.key !== key)].slice(0, SENT_MAX);
}

// Letzte Zahlung mit genau diesen Daten von diesem Konto in diesem Netz, sonst null.
export function findSentPayment(payment, now = Date.now()) {
  const key = sentKey(payment);
  return sentPayments.find((e) => e.key === key && now - e.at < SENT_WINDOW_MS) || null;
}

// Vermerk einer Zahlung entfernen (z.B. laut Horizon nicht ausgefuehrt). Mit hash nur,
// wenn der Vermerk genau diesen Hash hat.
export function forgetSentPayment(payment, hash = '') {
  const key = sentKey(payment);
  sentPayments = sentPayments.filter((e) => e.key !== key || (hash && e.hash !== hash));
}

/**
 * Unklare Vermerke von Konto und Netz mit einem dieser Hashes nach einer Klaerung (auch in
 * einem anderen Tab) angleichen: status 'success' -> gesendet (mit successHash), sonst
 * entfernen. Liefert, ob sich etwas geaendert hat.
 */
export function settleSentPaymentsByHash({ network, account, hashes, status, successHash = '' }) {
  const want = new Set((hashes || []).filter(Boolean).map((h) => String(h).toLowerCase()));
  if (!want.size) return false;
  let changed = false;
  const next = [];
  for (const e of sentPayments) {
    let parsed = null;
    try { parsed = JSON.parse(e.key); } catch { /* fremd */ }
    const match = e.status === 'ambiguous' && parsed && parsed[0] === String(network || '') && parsed[1] === String(account || '')
      && want.has(String(e.hash || '').toLowerCase());
    if (!match) { next.push(e); continue; }
    changed = true;
    if (status === 'success') next.push({ ...e, status: 'success', hash: successHash || e.hash });
  }
  sentPayments = next;
  return changed;
}
