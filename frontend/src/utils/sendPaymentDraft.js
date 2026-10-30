// Entwurf des Formulars "Zahlung senden", nur im Arbeitsspeicher.
//
// SendPaymentPage wird beim Kontowechsel kurz ausgehaengt (Konto-Sperre, solange kein
// Konto geladen ist) und danach neu eingehaengt. Ohne diesen Speicher waeren Empfaenger,
// Betrag, Asset und Memo dann weg. Gewollt ist: Eingaben bleiben beim Kontowechsel
// erhalten, damit dieselbe Zahlung nacheinander von mehreren Konten gesendet werden kann.
//
// Bewusst kein localStorage/sessionStorage: Nach einem Neuladen der Seite ist der
// Entwurf weg, genau wie vorher. Es werden keine Secrets abgelegt.
let draft = null;

export function readSendPaymentDraft() {
  return draft;
}

export function writeSendPaymentDraft(next) {
  draft = next ? { ...next } : null;
}

export function clearSendPaymentDraft() {
  draft = null;
}
