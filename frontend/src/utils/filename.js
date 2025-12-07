// src/utils/filename.js

/**
 * Shortens a Stellar public key to first 6 + '...' + last 6
 */
export function shortPublicKey(pk) {
  try {
    const s = String(pk || '');
    if (s.length >= 12) return `${s.slice(0, 6)}...${s.slice(-6)}`;
    return s || '';
  } catch {
    return '';
  }
}

/**
 * Sanitizes a label to be filesystem-friendly (letters incl. Unicode, numbers, _ and -).
 */
export function safeLabel(label) {
  try {
    const cleaned = String(label || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || 'file';
  } catch {
    return 'file';
  }
}

/**
 * Returns a local timestamp like YYYYMMDD_HHmmss
 */
export function localTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${MM}${dd}_${HH}${mm}${ss}`;
}

/**
 * Builds a default filename: <shortPk>_<menu>_<YYYYMMDD_HHmmss>.<ext>
 */
export function buildDefaultFilename({ publicKey, menuLabel, ext }) {
  const shortPk = shortPublicKey(publicKey);
  const label = safeLabel(menuLabel || 'Kontenliste');
  const ts = localTimestamp();
  const safeExt = String(ext || 'txt').replace(/[^A-Za-z0-9]/g, '');
  const nameParts = [];
  if (shortPk) nameParts.push(shortPk);
  nameParts.push(label);
  return `${nameParts.join('_')}_${ts}.${safeExt}`;
}
