// trustlineUtils.js

/**
 * Prüft, ob eine Trustline in der Auswahl enthalten ist
 */
export function isSelected(tl, selectedTrustlines) {
  return selectedTrustlines.some(
    sel =>
      sel.assetCode === tl.assetCode &&
      sel.assetIssuer === tl.assetIssuer
  );
}

/**
 * Gibt true zurück, wenn alle sichtbaren Trustlines mit Guthaben 0 ausgewählt sind
 */
export function areAllSelected(paginated, selectedTrustlines) {
  return paginated
    .filter(tl => parseFloat(tl.assetBalance) === 0)
    .every(tl => isSelected(tl, selectedTrustlines));
}

/**
 * Toggle alle Trustlines ohne Guthaben auf der aktuellen Seite:
 * - Wenn alle löschbaren (Balance 0) bereits ausgewählt sind → abwählen
 * - Sonst → nur löschbare (Balance 0) hinzufügen
 */
export function toggleAllTrustlines(paginated, selectedTrustlines) {
  const deletable = paginated.filter(tl => parseFloat(tl.assetBalance) === 0);
  const isSame = (a, b) => a.assetCode === b.assetCode && a.assetIssuer === b.assetIssuer;

  const allDeletableSelected = deletable.every(tl =>
    selectedTrustlines.some(sel => isSame(sel, tl))
  );

  if (allDeletableSelected) {
    return selectedTrustlines.filter(sel => !deletable.some(tl => isSame(sel, tl)));
  }
  const combined = [...selectedTrustlines];
  deletable.forEach(tl => {
    if (!combined.some(sel => isSame(sel, tl))) combined.push(tl);
  });
  return combined;
}

// Wechselt den Auswahltstatus einer einzelnen Trustline in der Liste.
// Vergleicht per AssetCode+Issuer, nicht per Objektidentität.
export function toggleTrustlineSelection(trustline, selectedTrustlines) {
  const isSame = (a, b) => a.assetCode === b.assetCode && a.assetIssuer === b.assetIssuer;
  const exists = selectedTrustlines.some((item) => isSame(item, trustline));
  if (exists) {
    return selectedTrustlines.filter((item) => !isSame(item, trustline));
  }
  return [...selectedTrustlines, trustline];
}
