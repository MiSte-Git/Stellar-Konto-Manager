// CSV-Import fuer die Sammelzahlung. Nur Lesen und lokale Pruefung, kein Netz: Die importierten Zeilen
// kommen in die Liste und laufen danach durch dieselbe Pruefung wie von Hand eingegebene (Pruefen-Knopf).
//
// Format: erste Zeile mit Spaltennamen (deutsch oder englisch, Gross-/Kleinschreibung egal), Trennzeichen Komma,
// Semikolon oder Tab (aus der Kopfzeile erkannt), Felder mit Anfuehrungszeichen nach RFC 4180, UTF-8 mit oder
// ohne BOM. Pflicht: Sender, Empfaenger, Betrag. Optional: Asset (XLM, CODE:ISSUER oder CODE-ISSUER, leer = XLM),
// Memo Typ (kein, text, id, hash, return; leer = text, bei leerem Memo kein), Memo.
//
// Fail-closed: Eine Zeile mit Fehler wird nicht uebernommen (Fehlerliste mit Zeilennummer). Eine Zeile, in der
// etwas wie ein Secret Key steht (auch ueber Zellen verteilt), wird nie uebernommen und ihr Inhalt nie angezeigt.
// Betraege wie 1.000 oder 1,000 sind mehrdeutig (Tausender oder Dezimal) und werden abgelehnt, ein Apostroph nur
// als Tausendergruppe (1'000). Jede Datenzeile hat genau so viele Zellen wie die Kopfzeile (leere am Ende erlaubt),
// sonst rutschen Werte in falsche Spalten (Review CI-1). Eine unbekannte Spalte mit Inhalt ist ein Dateifehler,
// nie still ignoriert: sie koennte Asset oder Memo tragen (Review CI-2, z. B. asset_code aus einem Export).
// Zellen ueber MAX_FIELD_LENGTH oder mit Steuer- und Formatzeichen werden abgelehnt (CI-7, CI-8).
import { containsSecretKey } from '../secretKeyDetection.js';
import { createEmptyRow, looksLikeThousandsSeparator, MEMO_TYPES } from './batchPaymentStore.js';
import { validateRowInput } from './batchPaymentLogic.js';

export const MAX_IMPORT_BYTES = 200 * 1024;
export const MAX_IMPORT_LINES = 1000;
export const MAX_FIELD_LENGTH = 200;

const HEADER_ALIASES = {
  source: ['sender', 'absender', 'source', 'from', 'von', 'quelle', 'quellkonto'],
  dest: ['empfaenger', 'empfänger', 'destination', 'dest', 'recipient', 'to', 'an', 'ziel'],
  asset: ['asset', 'token', 'waehrung', 'währung'],
  assetCode: ['asset_code', 'asset code', 'asset-code'],
  assetIssuer: ['asset_issuer', 'asset issuer', 'asset-issuer', 'issuer'],
  amount: ['betrag', 'amount', 'menge'],
  memoType: ['memo typ', 'memotyp', 'memo-typ', 'memo_typ', 'memo type', 'memotype', 'memo-type', 'memo_type'],
  memoVal: ['memo', 'memo text', 'memo wert', 'memo value'],
};
const MEMO_TYPE_ALIASES = { kein: 'none', keins: 'none', none: 'none', '': '' };

function normHeader(h) {
  // NFC: macOS speichert Umlaute oft zerlegt (Review CI-12).
  return String(h || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Trennzeichen aus der Kopfzeile: das haeufigste von ; , Tab ausserhalb von Anfuehrungszeichen. */
export function detectDelimiter(headerLine) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const ch of headerLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** RFC-4180-Parser. Liefert { records: [{ line, cells }], error }. line = Zeilennummer des Datensatzbeginns. */
export function parseCsv(text, delimiter) {
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let afterQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; afterQuote = true; }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    // Leerzeichen vor einem oeffnenden Anfuehrungszeichen tolerieren (Review CI-12).
    if (ch === '"' && cell.trim() === '' && !afterQuote) { quoted = true; cell = ''; continue; }
    if (afterQuote && ch === ' ') continue;
    if (ch === delimiter) { cells.push(cell); cell = ''; afterQuote = false; continue; }
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') {
      cells.push(cell);
      records.push({ line: startLine, cells });
      cells = []; cell = ''; afterQuote = false;
      line += 1; startLine = line;
      continue;
    }
    if (afterQuote) return { records, error: { code: 'importBadQuotes', line } };
    cell += ch;
  }
  if (quoted) return { records, error: { code: 'importBadQuotes', line: startLine } };
  if (cell !== '' || cells.length) { cells.push(cell); records.push({ line: startLine, cells }); }
  return { records, error: null };
}

function mapHeader(cells) {
  const map = {};
  const unknownIdx = [];
  cells.forEach((raw, idx) => {
    const h = normHeader(raw);
    const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(h));
    if (field && map[field] === undefined) map[field] = idx;
    else unknownIdx.push(idx); // auch doppelte und namenlose Spalten
  });
  return { map, unknownIdx };
}

function parseAsset(raw, code, issuer) {
  if (code !== undefined) {
    // Spaltenpaar asset_code / asset_issuer (wie die CSV-Exporte von SKM): XLM oder leerer Issuer = native.
    const c = String(code || '').trim();
    const i = String(issuer || '').trim();
    if (!c && !i) return 'XLM';
    if (/^xlm$/i.test(c) && !i) return 'XLM';
    if (!c && i) return 'invalid';
    return `${c}:${i}`;
  }
  const v = String(raw || '').trim();
  if (!v || /^xlm$/i.test(v) || /^native$/i.test(v)) return 'XLM';
  const m = /^([^:\-\s]+)[:-](G[A-Z2-7]{55})$/.exec(v);
  return m ? `${m[1]}:${m[2]}` : v;
}

// Betrag im Import strenger als im Formular: Tausendergruppen mit Punkt oder Komma sind mehrdeutig (CI-3), ein
// Apostroph nur als Tausendergruppe (CI-4).
function amountProblem(amount) {
  if (/^\d{1,3}([.,]\d{3})+$/.test(amount)) return 'importAmountAmbiguous';
  if (amount.includes("'") && !/^\d{1,3}('\d{3})+([.,]\d{1,7})?$/.test(amount)) return 'amountInvalid';
  return null;
}

// Steuer- und Formatzeichen (auch unsichtbare Richtungszeichen) innerhalb einer Zelle.
const BAD_CHARS_RE = /[\p{Cc}\p{Cf}]/u;

function parseMemoType(raw, memoVal) {
  const v = String(raw || '').trim().toLowerCase();
  const mapped = v in MEMO_TYPE_ALIASES ? MEMO_TYPE_ALIASES[v] : v;
  if (mapped === '') return String(memoVal || '').trim() ? 'text' : 'none';
  return MEMO_TYPES.includes(mapped) ? mapped : null;
}

/**
 * Datei-Bytes (ArrayBuffer oder Uint8Array) pruefen. Ergebnis:
 * { ok: false, error } (Datei als Ganzes unbrauchbar: notUtf8, tooLarge, tooManyLines, empty, missingColumns,
 *   importBadQuotes) oder { ok: true, rows, errors: [{ line, code }], unknownColumns }.
 */
export function parseBatchCsv(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (buf.length > MAX_IMPORT_BYTES) return { ok: false, error: { code: 'importTooLarge' } };
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return { ok: false, error: { code: 'importNotUtf8' } };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLineEnd = text.search(/\r?\n|\r/);
  const headerLine = firstLineEnd >= 0 ? text.slice(0, firstLineEnd) : text;
  if (!headerLine.trim()) return { ok: false, error: { code: 'importEmpty' } };
  const parsed = parseCsv(text, detectDelimiter(headerLine));
  if (parsed.error) return { ok: false, error: parsed.error };
  const [header, ...data] = parsed.records;
  if (data.length > MAX_IMPORT_LINES) return { ok: false, error: { code: 'importTooManyLines' } };
  // Secret Key oder ueberlange Zelle in der Kopfzeile: Dateifehler ohne Inhalt (Review CI-5).
  if (header.cells.some((c) => String(c).length > MAX_FIELD_LENGTH)) return { ok: false, error: { code: 'importHeaderInvalid' } };
  if (header.cells.some((c) => containsSecretKey(c)) || containsSecretKey(header.cells.join(''))) {
    return { ok: false, error: { code: 'containsSecret' } };
  }
  const { map, unknownIdx } = mapHeader(header.cells);
  const missing = ['source', 'dest', 'amount'].filter((f) => map[f] === undefined);
  if (missing.length) return { ok: false, error: { code: 'importMissingColumns', missing } };
  if ((map.assetCode !== undefined || map.assetIssuer !== undefined) && (map.asset !== undefined || map.assetCode === undefined || map.assetIssuer === undefined)) {
    return { ok: false, error: { code: 'importAssetColumns' } };
  }
  // Unbekannte Spalte mit Inhalt in irgendeiner Zeile: Dateifehler (CI-2). Leere unbekannte Spalten stoeren nicht.
  const usedUnknown = unknownIdx.filter((idx) => data.some((rec) => String(rec.cells[idx] ?? '').trim()));
  if (usedUnknown.length) {
    return { ok: false, error: { code: 'importUnknownColumns', columns: usedUnknown.map((i) => String(header.cells[i]).trim().slice(0, 40)) } };
  }
  const width = header.cells.length;

  const rows = [];
  const errors = [];
  for (const rec of data) {
    if (rec.cells.every((c) => !String(c).trim())) continue; // leere Zeile
    // Zellenzahl wie die Kopfzeile, leere Zellen am Ende erlaubt (CI-1).
    const extra = rec.cells.slice(width);
    if (rec.cells.length < width || extra.some((c) => String(c).trim())) {
      errors.push({ line: rec.line, code: 'importColumnCount', cells: rec.cells.length, width });
      continue;
    }
    // Laenge zuerst: schuetzt auch die Secret-Pruefung vor sehr langen Zellen (CI-7, CI-8).
    if (rec.cells.some((c) => String(c).length > MAX_FIELD_LENGTH)) { errors.push({ line: rec.line, code: 'importFieldTooLong' }); continue; }
    // Secret Key irgendwo in der Zeile, auch ueber Zellen verteilt (CI-6): nie uebernehmen, nichts davon anzeigen.
    if (rec.cells.some((c) => containsSecretKey(c)) || containsSecretKey(rec.cells.join(''))) {
      errors.push({ line: rec.line, code: 'containsSecret' });
      continue;
    }
    if (rec.cells.some((c) => BAD_CHARS_RE.test(String(c).trim()))) { errors.push({ line: rec.line, code: 'importInvalidCharacters' }); continue; }
    const get = (f) => (map[f] === undefined ? '' : String(rec.cells[map[f]] ?? ''));
    const amount = get('amount').trim();
    const amountCode = amountProblem(amount) || (looksLikeThousandsSeparator(amount) ? 'importAmountAmbiguous' : null);
    if (amountCode) { errors.push({ line: rec.line, code: amountCode }); continue; }
    const memoVal = get('memoVal');
    // Rueckstand des Formelschutzes eines Exports ('=, '+, '-, '@): nicht still mit Apostroph senden (CI-2.5).
    if (/^'[=+\-@]/.test(memoVal.trim())) { errors.push({ line: rec.line, code: 'importMemoFormulaPrefix' }); continue; }
    const memoType = parseMemoType(get('memoType'), memoVal);
    if (!memoType) { errors.push({ line: rec.line, code: 'importMemoTypeInvalid' }); continue; }
    const row = createEmptyRow({
      source: get('source').trim(),
      dest: get('dest').trim(),
      assetKey: map.assetCode !== undefined ? parseAsset('', get('assetCode'), get('assetIssuer')) : parseAsset(get('asset')),
      amount,
      memoType,
      memoVal: memoType === 'none' ? '' : memoVal.trim(),
    });
    if (memoType === 'none' && memoVal.trim()) { errors.push({ line: rec.line, code: 'importMemoWithoutType' }); continue; }
    const code = validateRowInput(row);
    if (code) { errors.push({ line: rec.line, code }); continue; }
    rows.push({ line: rec.line, row });
  }
  return { ok: true, rows, errors, noAssetColumn: map.asset === undefined && map.assetCode === undefined };
}
