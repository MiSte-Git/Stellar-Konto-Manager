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
// - Felder, die wie ein Secret Key aussehen, werden nicht uebernommen.
// - Gesendete Zahlungen werden je Konto vermerkt, damit die Seite beim gleichen Konto
//   mit gleichen Daten warnen kann (der Entwurf selbst bleibt fuer das naechste Konto).
import { containsSecretKey } from './batchPayment/batchPaymentStore.js';

const SENT_MAX = 20;
const SENT_WINDOW_MS = 20 * 60 * 60 * 1000;

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

// status: 'success' | 'ambiguous'
export function recordSentPayment(payment, { hash = '', status = 'success', at = Date.now() } = {}) {
  const key = sentKey(payment);
  sentPayments = [{ key, hash, status, at }, ...sentPayments.filter((e) => e.key !== key)].slice(0, SENT_MAX);
}

// Letzte Zahlung mit genau diesen Daten von diesem Konto in diesem Netz, sonst null.
export function findSentPayment(payment, now = Date.now()) {
  const key = sentKey(payment);
  return sentPayments.find((e) => e.key === key && now - e.at < SENT_WINDOW_MS) || null;
}
