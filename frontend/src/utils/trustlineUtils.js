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
    .filter(tl => tl.assetBalance === "0.0000000")
    .every(tl => isSelected(tl, selectedTrustlines));
}

/**
 * Toggle alle Trustlines ohne Guthaben:
 * - Wenn alle löschbaren Trustlines schon ausgewählt sind → abwählen
 * - Sonst → nur löschbare zur Auswahl hinzufügen
 */
export function toggleAllTrustlines(paginated, selectedTrustlines) {
  const deletable = paginated.filter(tl => tl.assetBalance === "0.0000000");

  const isSameTrustline = (a, b) =>
    a.assetCode === b.assetCode && a.assetIssuer === b.assetIssuer;

  const allDeletableSelected = deletable.every(tl =>
    selectedTrustlines.some(sel => isSameTrustline(sel, tl))
  );

  if (allDeletableSelected) {
    return selectedTrustlines.filter(
      sel => !deletable.some(tl => isSameTrustline(tl, sel))
    );
  } else {
    const combined = [...selectedTrustlines];
    deletable.forEach(tl => {
      if (!combined.some(sel => isSameTrustline(sel, tl))) {
        combined.push(tl);
      }
    });
    return combined;
  }
}

// Wechselt den Auswahltstatus einer einzelnen Trustline in der Liste.
// Gibt die aktualisierte Liste zurück (ohne setState selbst aufzurufen).
export function toggleTrustlineSelection(trustline, selectedTrustlines) {
  const exists = selectedTrustlines.includes(trustline);
  if (exists) {
    return selectedTrustlines.filter((item) => item !== trustline);
  } else {
    return [...selectedTrustlines, trustline];
  }
}
