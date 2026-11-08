// Anzeige von Memo und Adressen: links-nach-rechts, als eigene Einheit isoliert.
//
// Ein Memo oder eine Adresse ist Fremdtext. Enthaelt er Rechts-nach-links-Buchstaben (z. B.
// Arabisch, Hebraeisch), koennen sie ohne Steuerzeichen die Reihenfolge benachbarter Ziffern
// und Buchstaben optisch vertauschen, auch ausserhalb des Textes (Betrag, Label daneben).
// dir="ltr" mit unicode-bidi: isolate haelt die Reihenfolge im Text und verhindert, dass der Text
// die Umgebung umordnet. Die Zeichen selbst bleiben unveraendert (Maskierung unsichtbarer
// Zeichen macht describeTransaction/escapeInvisible).
//
// Verwendung: <span {...BIDI_ISOLATE} className="font-mono">{memo}</span>
export const BIDI_ISOLATE = Object.freeze({ dir: 'ltr', style: Object.freeze({ unicodeBidi: 'isolate' }) });
