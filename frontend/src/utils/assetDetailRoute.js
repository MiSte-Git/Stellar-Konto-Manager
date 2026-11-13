// Route der Asset-Detailseite: /assets/CODE-ISSUER (verlinkbar, auch ohne Konto).
// Der Code besteht nur aus Buchstaben und Ziffern, der Bindestrich trennt also eindeutig.
import { StrKey } from '@stellar/stellar-sdk';
import { buildPath, getBasePath } from './basePath.js';

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/** true, wenn Code und Issuer ein gueltiges Nicht-XLM-Asset ergeben (Issuer mit Pruefsumme). */
export function isValidAssetIdentity(code, issuer) {
  return ASSET_CODE_RE.test(String(code || '')) && StrKey.isValidEd25519PublicKey(String(issuer || ''));
}

/** Unterpfad ohne Basis (fuer navigateToPath). */
export function assetDetailSubpath(code, issuer) {
  return `assets/${encodeURIComponent(code)}-${encodeURIComponent(issuer)}`;
}

/** Voller Pfad mit Basis. */
export function assetDetailPath(code, issuer) {
  return buildPath(assetDetailSubpath(code, issuer));
}

/**
 * Liest { code, issuer } aus dem Pfad. null, wenn der Pfad keine Asset-Detailseite ist.
 * { code, issuer, invalid: true }, wenn der Pfad passt, das Asset aber ungueltig ist
 * (die Seite zeigt dann einen Hinweis statt still zur Startseite zu springen).
 */
export function parseAssetDetailPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const base = getBasePath();
  let rest = current.startsWith(base) ? current.slice(base.length) : current.replace(/^\/+/, '');
  rest = rest.replace(/\/+$/, '');
  const m = /^assets\/([^/]+)$/.exec(rest);
  if (!m) return null;
  let raw;
  try { raw = decodeURIComponent(m[1]); } catch { return { code: '', issuer: '', invalid: true }; }
  const idx = raw.lastIndexOf('-');
  const code = idx > 0 ? raw.slice(0, idx) : raw;
  const issuer = idx > 0 ? raw.slice(idx + 1) : '';
  return isValidAssetIdentity(code, issuer) ? { code, issuer } : { code, issuer, invalid: true };
}

export function isAssetDetailPath(pathname) {
  return parseAssetDetailPath(pathname) !== null;
}

/** Trading mit vorbelegtem Asset: /trading/assets?asset=CODE:ISSUER */
export function tradingWithAssetSubpath(code, issuer) {
  return `trading/assets?asset=${encodeURIComponent(`${code}:${issuer}`)}`;
}

/** Liest ?asset=CODE:ISSUER, nur wenn gueltig; sonst null. */
export function readTradingAssetFromSearch(search) {
  try {
    const qs = typeof search === 'string' ? search : (typeof window !== 'undefined' ? window.location.search : '');
    const value = String(new URLSearchParams(qs).get('asset') || '').trim();
    const [code, issuer, extra] = value.split(':');
    if (extra !== undefined) return null;
    return isValidAssetIdentity(code, issuer) ? { code, issuer } : null;
  } catch {
    return null;
  }
}
