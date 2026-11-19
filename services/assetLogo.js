// Logo-Proxy fuer GET /api/trade/assets/logo. Gegenstueck zu api/assetLogo.php, gemeinsame Faelle in
// test/assets/asset-logo.json.
//
// Ablauf: Issuer-Konto (Horizon) -> home_domain -> stellar.toml -> erster CURRENCIES-Eintrag mit genau diesem
// Code und Issuer -> dessen image (nur https) -> Bild ueber den SSRF-Schutz laden. Der Browser laedt nie
// direkt von der Domain des Issuers (CSP img-src bleibt 'self').
//
// Ausgeliefert wird PNG, JPEG oder WebP, erkannt an den ersten Bytes (nie am Content-Type oder an der Endung des
// Issuers), Breite und Hoehe aus dem Bildkopf, je hoechstens MAX_DIMENSION; dazu SVG nur nach der strengen
// Pruefung in services/svgLogo.js (Bytes unveraendert, ohne Abmessungspruefung). Hoechstens MAX_BYTES, der Abruf
// bricht beim Lesen ab. Die Antwort-Header setzen wir selbst, von der Gegenseite wird kein Header uebernommen.
const { assertSafeScheme, ssrfSafeAgent, nextRedirectUrl, readBytesWithLimit } = require('./ssrfGuard.js');
const { asciiTrim } = require('./addressKind.js');
const { checkSvgLogo } = require('./svgLogo.js');
const {
  normalizeAssetIdentity,
  buildTomlUrl,
  fetchTextWithTimeout,
  looksLikeHtml,
  parseCurrencySectionsFromToml,
  currencyMatches,
} = require('./tradeService.js');

const MAX_BYTES = 256 * 1024;
const MAX_DIMENSION = 1024;
const MAX_URL_LENGTH = 2048;
const CACHE_SECONDS = 24 * 60 * 60;
const ERROR_CACHE_SECONDS = 60 * 60;
const IMAGE_FETCH_TIMEOUT_MS = 6000;
const HORIZON_TIMEOUT_MS = 8000; // wie SKM_JSON_FETCH_TIMEOUT_SECONDS in api/ssrfGuard.php
const MAX_IMAGE_REDIRECTS = 5;

// Review LP-2: Schleifenschutz. Unsere Abrufe von stellar.toml und Bild tragen diesen Header; eine Anfrage mit
// ihm lehnt der Endpunkt vor dem Rate-Limit ab. Sonst koennte das image von Asset A auf unseren eigenen
// Logo-Endpunkt fuer Asset B zeigen und B zurueck auf A (Kette von Anfragen des Servers an sich selbst).
// Gleicher Name wie ASSET_LOGO_HOP_HEADER in api/assetLogo.php.
const HOP_HEADER = 'x-skm-logo-hop';

const ERROR_STATUS = Object.freeze({
  noHomeDomain: 404,
  notListed: 404,
  noImage: 404,
  issuerUnavailable: 502,
  tomlUnavailable: 502,
  fetchFailed: 502,
  tooLarge: 502,
  unsupportedType: 502,
  invalidImage: 502,
  dimensionsTooLarge: 502,
  unsafeSvg: 502,
});

const SVG_MIME = 'image/svg+xml; charset=utf-8';

// Nur ASCII, nur https, Host aus Labels (keine Zugangsdaten, kein IP-Literal in Klammern, kein IDN), optional
// Port, danach druckbare Zeichen ohne Leerzeichen und Backslash. Gleicher Ausdruck in api/assetLogo.php.
const IMAGE_URL_RE = /^https:\/\/(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::(\d{1,5}))?(?:[/?#][\x21-\x5b\x5d-\x7e]*)?$/i;

/** image-Feld aus dem CURRENCIES-Eintrag als URL, die wir abrufen duerfen, sonst null. */
function logoUrlFromImage(image) {
  if (typeof image !== 'string') return null;
  // Nur ASCII-Leerraum wie trim() in PHP; anderer Leerraum faellt danach am Ausdruck durch.
  const url = asciiTrim(image);
  if (url === '' || url.length > MAX_URL_LENGTH) return null;
  const m = IMAGE_URL_RE.exec(url);
  if (!m) return null;
  if (m[1] !== undefined && Number(m[1]) > 65535) return null;
  return url;
}

const fail = (error) => ({ ok: false, error });

function u16be(b, i) { return (b[i] << 8) | b[i + 1]; }
function u16le(b, i) { return b[i] | (b[i + 1] << 8); }
function u24le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }
function u32be(b, i) { return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]); }
function u32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0); }
function ascii(b, i, n) { return b.length >= i + n ? String.fromCharCode(...b.subarray(i, i + n)) : ''; }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b) {
  // Erster Chunk muss IHDR mit Laenge 13 sein: Breite und Hoehe ab Byte 16.
  if (b.length < 24 || u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b) {
  let i = 2;
  for (;;) {
    if (i >= b.length || b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i += 1; // Fuellbytes
    if (i >= b.length) return null;
    const marker = b[i];
    i += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // ohne Laenge
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null; // SOI, EOI, SOS vor einem SOF
    if (i + 2 > b.length) return null;
    const len = u16be(b, i);
    if (len < 2) return null;
    // SOF0..SOF15 ausser DHT (C4), JPG (C8), DAC (CC): Laenge, Praezision, Hoehe, Breite.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7 || i + 7 > b.length) return null;
      return { width: u16be(b, i + 5), height: u16be(b, i + 3) };
    }
    i += len;
  }
}

function webpSize(b) {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/**
 * Bildtyp und Groesse aus den ersten Bytes. { ok, mime, ext, width, height } oder { ok: false, error }.
 * Fehler: tooLarge (Bytes), unsupportedType (weder PNG/JPEG/WebP-Signatur noch SVG), invalidImage (Kopf kaputt,
 * 0 Pixel oder SVG ohne gueltiges UTF-8), dimensionsTooLarge (Breite oder Hoehe ueber MAX_DIMENSION), unsafeSvg
 * (SVG besteht die Pruefung in services/svgLogo.js nicht). SVG ohne Abmessungspruefung: width und height null.
 * options.svgDisabledRules nur fuer die Gegenprobe in den Tests.
 */
function sniffLogoImage(input, options = {}) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (b.length > MAX_BYTES) return fail('tooLarge');
  let type;
  let size;
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) {
    type = { mime: 'image/png', ext: 'png' };
    size = pngSize(b);
  } else if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    type = { mime: 'image/jpeg', ext: 'jpg' };
    size = jpegSize(b);
  } else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    type = { mime: 'image/webp', ext: 'webp' };
    size = webpSize(b);
  } else {
    // Weder PNG noch JPEG noch WebP: SVG nur nach strenger Pruefung (Anlass: Circle USDC/EURC liefern nur SVG).
    const svg = checkSvgLogo(b, options.svgDisabledRules);
    if (svg !== 'ok') return fail(svg);
    return { ok: true, mime: SVG_MIME, ext: 'svg', width: null, height: null };
  }
  if (!size || size.width < 1 || size.height < 1) return fail('invalidImage');
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) return fail('dimensionsTooLarge');
  return { ok: true, ...type, width: size.width, height: size.height };
}

// Bild ueber den SSRF-Schutz laden: nur https (auch nach jeder Weiterleitung), Abbruch beim Lesen ab
// MAX_BYTES. Wir verlangen identity; entpackt undici trotzdem, gilt die Grenze fuer die entpackten Bytes.
async function fetchImageBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= MAX_IMAGE_REDIRECTS; redirects += 1) {
      if (assertSafeScheme(currentUrl).protocol !== 'https:') throw new Error('ssrf.blocked:scheme');
      const response = await fetch(currentUrl, {
        headers: { accept: 'image/png, image/jpeg, image/webp, image/svg+xml', 'accept-encoding': 'identity', [HOP_HEADER]: '1' },
        signal: controller.signal,
        redirect: 'manual',
        dispatcher: ssrfSafeAgent,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel?.().catch(() => {});
        currentUrl = nextRedirectUrl(currentUrl, response.headers.get('location'));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`HTTP ${response.status}`);
      }
      return await readBytesWithLimit(response, MAX_BYTES);
    }
    throw new Error('ssrf.blocked:tooManyRedirects');
  } finally {
    clearTimeout(timer);
  }
}

function isTooLargeError(error) {
  return String(error?.message || '') === 'ssrf.blocked:responseTooLarge'
    || String(error?.cause?.message || '') === 'ssrf.blocked:responseTooLarge';
}

/**
 * Ganzer Ablauf. Ungueltiger Code/Issuer wirft assetSearch.invalidInput:* (400 in der Route).
 * Ergebnis: { ok: true, mime, ext, width, height, bytes } oder { ok: false, error, status }.
 * fetchToml und fetchImage sind fuer Tests austauschbar.
 */
const fetchTomlWithHop = (url) => fetchTextWithTimeout(url, { [HOP_HEADER]: '1' });

// Frist fuer Horizon: das Timeout des SDK-Servers ist hier nicht festgelegt (Review LP-1).
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchAssetLogo({
  assetCode, issuer, horizon, fetchToml = fetchTomlWithHop, fetchImage = fetchImageBytes, horizonTimeoutMs = HORIZON_TIMEOUT_MS,
}) {
  const asset = normalizeAssetIdentity({ assetCode, issuer });
  const result = (error) => ({ ok: false, error, status: ERROR_STATUS[error] });

  let account;
  try {
    account = await withTimeout(Promise.resolve().then(() => horizon.loadAccount(asset.issuer)), horizonTimeoutMs);
  } catch {
    return result('issuerUnavailable');
  }
  const tomlUrl = buildTomlUrl(account?.home_domain || account?.homeDomain || '');
  if (!tomlUrl) return result('noHomeDomain');

  let currencies;
  try {
    const text = await fetchToml(tomlUrl);
    if (looksLikeHtml(text)) return result('tomlUnavailable');
    currencies = parseCurrencySectionsFromToml(text);
  } catch {
    return result('tomlUnavailable');
  }
  // Wie /facts: Code und Issuer exakt (Gross-/Kleinschreibung zaehlt). Der erste Eintrag zaehlt, wie in
  // frontend/src/utils/stellar/issuerToml.js; kein Rueckgriff auf spaetere Eintraege.
  const match = currencies.find((c) => currencyMatches(c, asset));
  if (!match) return result('notListed');
  const url = logoUrlFromImage(match.image);
  if (!url) return result('noImage');

  let bytes;
  try {
    bytes = await fetchImage(url);
  } catch (error) {
    return result(isTooLargeError(error) ? 'tooLarge' : 'fetchFailed');
  }
  const sniffed = sniffLogoImage(bytes);
  if (!sniffed.ok) return result(sniffed.error);
  return { ...sniffed, bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) };
}

/**
 * Review LP-2 und LP-3: Anfrage vor dem Rate-Limit ablehnen? hop = Wert von X-SKM-Logo-Hop, dest = Wert von
 * Sec-Fetch-Dest (fehlend oder leer: nicht gesetzt). Ein Browser schickt bei <img> immer "image"; jeder andere
 * Wert (Aufruf als Dokument, fetch, iframe, ...) wird abgelehnt, damit die Bytes nie als eigene Seite unter
 * unserer Domain erscheinen. Ohne Sec-Fetch-Dest (alte Browser, Skripte) bleibt die Anfrage erlaubt.
 * Ergebnis: null oder { status: 404, error }.
 */
function logoRequestRefusal(hop, dest) {
  if (typeof hop === 'string' && hop !== '') return { status: 404, error: 'hopRefused' };
  if (typeof dest === 'string' && dest !== '' && dest !== 'image') return { status: 404, error: 'notImageRequest' };
  return null;
}

const LOGO_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/** Unsere Header fuer ein ausgeliefertes Logo. */
function logoSuccessHeaders(result) {
  return {
    'Content-Type': result.mime,
    'Content-Length': String(result.bytes.length),
    'Content-Disposition': `inline; filename="logo.${result.ext}"`,
    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': LOGO_CSP,
    'Cross-Origin-Resource-Policy': 'same-site',
  };
}

// Voruebergehende Fehler: Horizon, stellar.toml oder Bild gerade nicht erreichbar. Die Antwort wird nicht
// zwischengespeichert, damit das Logo nach einem Ausfall sofort wieder erscheint. Gleiche Liste in
// api/assetLogo.php und test/assets/asset-logo.json (transientErrors).
const TRANSIENT_ERRORS = Object.freeze(['issuerUnavailable', 'tomlUnavailable', 'fetchFailed']);

/**
 * Header fuer "kein Logo" (404/502). Voruebergehende Fehler no-store, alle uebrigen (die Angabe des Issuers
 * selbst passt nicht) eine Stunde zwischenspeicherbar, damit nicht jede Ansicht neu laedt.
 */
function logoErrorHeaders(error) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': TRANSIENT_ERRORS.includes(error) ? 'no-store' : `public, max-age=${ERROR_CACHE_SECONDS}`,
    'X-Content-Type-Options': 'nosniff',
  };
}

module.exports = {
  MAX_BYTES,
  MAX_DIMENSION,
  MAX_URL_LENGTH,
  CACHE_SECONDS,
  ERROR_CACHE_SECONDS,
  ERROR_STATUS,
  TRANSIENT_ERRORS,
  HOP_HEADER,
  IMAGE_FETCH_TIMEOUT_MS,
  HORIZON_TIMEOUT_MS,
  logoRequestRefusal,
  logoUrlFromImage,
  sniffLogoImage,
  fetchImageBytes,
  fetchAssetLogo,
  logoSuccessHeaders,
  logoErrorHeaders,
};
