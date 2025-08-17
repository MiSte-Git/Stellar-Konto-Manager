// Schaltet die Sortierrichtung um, wenn dieselbe Spalte erneut gewählt wird,
// oder setzt die neue Spalte mit default Richtung "asc".
export function handleSort(column, currentSortColumn, currentSortDirection, setSortColumn, setSortDirection) {
  if (currentSortColumn === column) {
    setSortDirection(currentSortDirection === 'asc' ? 'desc' : 'asc');
  } else {
    setSortColumn(column);
    setSortDirection('asc');
  }
}
// Aktualisiert einen bestimmten Filter und setzt die Seite zurück auf 0.
export function handleFilterChange(key, value, currentFilters, setFilters, setCurrentPage) {
  setFilters({ ...currentFilters, [key]: value });
  setCurrentPage(0); // Bei Filterwechsel zur ersten Seite springen
}
