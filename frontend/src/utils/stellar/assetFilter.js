// Filter fuer Asset-Listen (Wallet-Startseite, spaeter Token suchen und handeln, Kontoliste).
// Rein, ohne Netz: Teilstring ohne Gross-/Kleinschreibung auf Code und Issuer. CODE:ISSUER
// verlangt beides. Pool-Anteile treffen ueber die Codes ihres Paars und die Pool-ID.

/**
 * @param {{ code?: string, issuer?: string, isPool?: boolean, isNative?: boolean, pairCodes?: string[] }} asset
 * @param {string} query
 */
export function matchesAssetQuery(asset, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (!asset) return false;
  const code = String(asset.code || '').toLowerCase();
  const issuer = String(asset.issuer || '').toLowerCase();
  const pairCodes = (Array.isArray(asset.pairCodes) ? asset.pairCodes : []).map((c) => String(c || '').toLowerCase());
  const colon = q.indexOf(':');
  if (colon > 0 && !asset.isPool) {
    const qc = q.slice(0, colon).trim();
    const qi = q.slice(colon + 1).trim();
    return code.includes(qc) && (!qi || issuer.includes(qi));
  }
  if (asset.isPool) {
    return issuer.includes(q) || pairCodes.some((c) => c.includes(q)) || pairCodes.join(' / ').includes(q) || pairCodes.join('/').includes(q);
  }
  return code.includes(q) || issuer.includes(q);
}

export function filterAssets(assets, query) {
  return (Array.isArray(assets) ? assets : []).filter((a) => matchesAssetQuery(a, query));
}
