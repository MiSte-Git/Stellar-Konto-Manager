// Shared CSV cell escaping used by every CSV export in the app.
// Guards against two things:
// - Broken CSV syntax: quotes/newlines/the delimiter itself inside a cell.
// - CSV/spreadsheet formula injection: a cell starting with =, +, -, @, Tab or CR
//   is interpreted as a formula by Excel/Sheets when the file is opened there.
export function csvEscape(value, delimiter = ',') {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter)) {
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
