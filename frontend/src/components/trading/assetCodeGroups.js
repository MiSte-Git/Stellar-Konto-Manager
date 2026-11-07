// Gleiche Asset-Codes in Suchergebnissen gruppieren, ohne Gross-/Kleinschreibung.
// Ein Asset-Code ist auf Stellar case-sensitiv (ldex und LDEX sind verschiedene Assets),
// sieht aber fuer Nutzer gleich aus. Deshalb zaehlen beide Schreibweisen zusammen, und
// Schreibvarianten werden eigens ausgewiesen.
export function groupAssetCodes(results) {
  const groups = new Map(); // klein geschriebener Code -> { count, variants:Set }
  (results || []).forEach((r) => {
    const code = r?.assetCode || '';
    const key = code.toLowerCase();
    const g = groups.get(key) || { count: 0, variants: new Set() };
    g.count += 1;
    g.variants.add(code);
    groups.set(key, g);
  });
  const countOf = (code) => groups.get((code || '').toLowerCase())?.count || 0;
  const isDuplicate = (code) => countOf(code) > 1;
  // Schreibvariante: derselbe Code kommt in den Ergebnissen auch anders geschrieben vor.
  const hasVariants = (code) => (groups.get((code || '').toLowerCase())?.variants.size || 0) > 1;
  const duplicateCodes = [...groups.values()]
    .filter((g) => g.count > 1)
    .flatMap((g) => [...g.variants]); // Set je Gruppe: keine doppelten Eintraege
  const variantCodes = [...groups.values()]
    .filter((g) => g.variants.size > 1)
    .flatMap((g) => [...g.variants]);
  return { countOf, isDuplicate, hasVariants, duplicateCodes, variantCodes };
}
