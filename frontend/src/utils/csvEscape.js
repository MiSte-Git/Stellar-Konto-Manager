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
