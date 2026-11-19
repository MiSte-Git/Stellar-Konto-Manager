// Angaben des Issuers aus seiner stellar.toml (SEP-1, Abschnitt CURRENCIES) für die Asset-Detailseite.
// Die Werte kommen ungeprüft von der Domain des Issuers. Darum hier nur einfache Werte (Text, Zahl, Ja/Nein),
// Steuerzeichen raus, Länge begrenzt, URLs nur als Text (nie als Link, Phishing-Schutz).

const MAX_SHORT = 120;
const MAX_LONG = 600;

// Reihenfolge der Anzeige. kind: text | long | url | bool | int | decimals | status
export const ISSUER_TOML_FIELDS = [
  { key: 'name', kind: 'text' },
  { key: 'desc', kind: 'long' },
  { key: 'status', kind: 'status' },
  { key: 'anchor_asset_type', kind: 'text' },
  { key: 'anchor_asset', kind: 'text' },
  { key: 'is_asset_anchored', kind: 'bool' },
  { key: 'display_decimals', kind: 'decimals' },
  { key: 'is_unlimited', kind: 'bool' },
  { key: 'fixed_number', kind: 'int' },
  { key: 'max_number', kind: 'int' },
  { key: 'regulated', kind: 'bool' },
  { key: 'conditions', kind: 'long' },
  { key: 'redemption_instructions', kind: 'long' },
  { key: 'attestation_of_reserve', kind: 'url' },
];

const KNOWN_STATUS = new Set(['live', 'dead', 'test', 'private']);

// Steuerzeichen (ausser Zeilenumbruch bei langen Texten) und unsichtbare Richtungszeichen entfernen,
// damit niemand mit RTL-Override oder Nullbreite-Zeichen einen anderen Text vortäuscht.
function cleanText(value, max, allowNewlines) {
  if (typeof value !== 'string') return '';
  let s = value.replace(/[\u061C\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '');
  /* eslint-disable no-control-regex -- Steuerzeichen sollen hier gerade gefunden werden */
  s = allowNewlines
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  /* eslint-enable no-control-regex */
  s = s.trim();
  if (!s) return '';
  if (s.length > max) return { text: s.slice(0, max).trimEnd(), truncated: true };
  return { text: s, truncated: false };
}

function toBool(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toNonNegInt(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function normalizeField(field, raw) {
  switch (field.kind) {
    case 'bool': {
      const b = toBool(raw);
      return b === null ? null : { value: b };
    }
    case 'int': {
      const n = toNonNegInt(raw);
      return n === null ? null : { value: n };
    }
    case 'decimals': {
      const n = toNonNegInt(raw);
      return n === null || n > 7 ? null : { value: n };
    }
    case 'status': {
      const c = cleanText(raw, 20, false);
      if (!c) return null;
      const lower = c.text.toLowerCase();
      return KNOWN_STATUS.has(lower) ? { value: lower, known: true } : { value: c.text, known: false };
    }
    case 'url': {
      const c = cleanText(raw, 300, false);
      return c ? { value: c.text, truncated: c.truncated } : null;
    }
    case 'long': {
      const c = cleanText(raw, MAX_LONG, true);
      return c ? { value: c.text, truncated: c.truncated } : null;
    }
    default: {
      const c = cleanText(raw, MAX_SHORT, false);
      return c ? { value: c.text, truncated: c.truncated } : null;
    }
  }
}

/**
 * Liefert den Zustand der Issuer-Angaben für ein Asset aus den facts (useAssetFacts).
 * state: loading | unavailable (TOML nicht geladen) | notListed | empty (Eintrag ohne verwertbare Felder) | ok
 * entries: [{ key, kind, value, known?, truncated? }]
 * multiple: Asset ist mehrfach eingetragen, gezeigt wird der erste Eintrag (wie im Backend für das Logo).
 * hasImage: Eintrag nennt ein Bild (dann lohnt die Logo-Anfrage an unser Backend).
 */
export function issuerTomlInfo(facts) {
  const toml = (facts && facts.toml) || {};
  // notChecked ohne Fehler: der Abruf startet erst nach dem ersten Render
  if (!facts || facts.loading || (toml.status === 'notChecked' && !facts.error)) {
    return { state: 'loading', entries: [], multiple: false, hasImage: false };
  }
  if (toml.status !== 'loaded') return { state: 'unavailable', entries: [], multiple: false, hasImage: false };
  const matches = Array.isArray(toml.matches) ? toml.matches.filter((m) => m && typeof m === 'object') : [];
  if (matches.length === 0) return { state: 'notListed', entries: [], multiple: false, hasImage: false };
  const first = matches[0];
  const entries = [];
  for (const field of ISSUER_TOML_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(first, field.key)) continue;
    const norm = normalizeField(field, first[field.key]);
    if (norm) entries.push({ key: field.key, kind: field.kind, ...norm });
  }
  const hasImage = typeof first.image === 'string' && /^https:\/\//i.test(first.image.trim());
  return {
    state: entries.length ? 'ok' : 'empty',
    entries,
    multiple: matches.length > 1,
    hasImage,
  };
}
