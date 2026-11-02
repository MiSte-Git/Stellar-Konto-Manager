// Shared CSV cell escaping used by every CSV export in the app.
// Guards against two things:
// - Broken CSV syntax: quotes/newlines/separators inside a cell.
// - CSV/spreadsheet formula injection: a cell starting with =, +, -, @ (also after
//   leading whitespace, V4) or with Tab/CR is interpreted as a formula by some
//   spreadsheet programs. Such cells get a leading '.
// Quoting does not depend on the delimiter passed in (F1): the program opening the file
// may split on a different list separator than the export used (Excel with an English
// locale splits on ",", with a German one on ";"). An unquoted "x,=1+1" in a ";" export
// would then become a cell "=1+1" of its own. So every cell containing ",", ";", Tab,
// '"', LF or CR is quoted, whatever delimiter the export uses.
const FORMULA_START = /^(?:\s*[=+\-@]|[\t\r])/;
const NEEDS_QUOTES = /[,;\t"\n\r]/;

export function csvEscape(value, delimiter = ',') {
  let s = String(value ?? '');
  if (FORMULA_START.test(s)) {
    s = "'" + s;
  }
  if (NEEDS_QUOTES.test(s) || s.includes(delimiter)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Eine CSV-Zeile aus Zellen. Echte JS-Zahlen bleiben unveraendert (auch negative): Sie
// koennen keine Formel enthalten, ein ' davor wuerde sie in der Tabelle zu Text machen.
// Alles andere laeuft durch csvEscape, also auch Memos und andere fremde Texte.
export function csvLine(cells, delimiter = ',') {
  return cells
    .map((cell) => (typeof cell === 'number' && Number.isFinite(cell) ? String(cell) : csvEscape(cell, delimiter)))
    .join(delimiter);
}
