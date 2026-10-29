// SEP-2 federation lookups done server-side (Backlog P1.2).
//
// Why on the backend: forward resolution (name*domain -> account) and the
// reverse lookup (account -> name via its home_domain) both need
// stellar.toml and a FEDERATION_SERVER of *arbitrary* domains. Doing that in
// the browser would force connect-src to allow every https: host, which
// would void the CSP's protection against data exfiltration. Here the
// requests go through the same SSRF-safe connect path as the trading TOML
// checks (services/tradeService.js), with https only, no redirects, a
// timeout and a size cap per request.
//
// PHP twin: api/federationService.php + api/federation.php. Both are covered
// by the same cases in test/federationService.test.js and
// test/federationService.test.php - keep them in step.
//
// Reverse lookup rules (a federation server can claim any name it likes, so
// the result is only ever shown as "name according to <domain>"):
// 1. home_domain comes from Horizon, never from the client.
// 2. stellar.toml only via https from exactly that domain, FEDERATION_SERVER
//    only https.
// 3. The returned stellar_address must be name*domain with domain equal to
//    the home_domain (case-insensitive).
// 4. Cross-check: the name is resolved forward again (type=name on that
//    same domain's FEDERATION_SERVER) and must yield exactly the same
//    account_id.
// Any failed step means "no result" - never an error the UI has to show.
const StellarSdk = require('@stellar/stellar-sdk');
const { assertSafeScheme, readTextWithLimit, ssrfSafeAgent } = require('./tradeService.js');

const FEDERATION_FETCH_TIMEOUT_MS = 5000;
const MAX_TOML_BYTES = 256 * 1024;
const MAX_FEDERATION_RESPONSE_BYTES = 64 * 1024;
const MAX_ADDRESS_LENGTH = 256;
const MAX_NAME_LENGTH = 128;
const MAX_HOME_DOMAIN_LENGTH = 32; // Stellar protocol limit for home_domain
const MAX_FEDERATION_SERVER_URL_LENGTH = 512;
// Lowercase DNS hostname with at least one dot and an alphabetic TLD - no IP
// literals, no ports, no trailing dot. Identical pattern in PHP.
const HOSTNAME_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
// Name part of name*domain: printable ASCII only, without '*' and '>'.
// ASCII-only on purpose: Unicode lookalikes (fullwidth asterisk, bidi
// overrides, zero-width characters, homoglyphs) could otherwise make a
// reverse-lookup name *look* like it belongs to another domain. It also
// keeps Node and PHP byte-for-byte identical (length, case folding).
const NAME_RE = /^[\x21-\x29\x2b-\x3d\x3f-\x7e]+$/;
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;

// Same characters as PHP's trim() default, so both backends trim identically.
function asciiTrim(value) {
  return value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}
const MEMO_TYPES = new Set(['text', 'id', 'hash']);
// Sent on every outbound federation request. An incoming /api/federation
// request carrying it came from a backend (ours or a twin) and is refused,
// so a stellar.toml pointing FEDERATION_SERVER at /api/federation can't make
// the backend call itself in a loop (each level holding a worker).
const HOP_HEADER = 'x-skm-federation-hop';
const UINT64_MAX = 18446744073709551615n;

class FederationError extends Error {
  constructor(code) {
    super(`federation.${code}`);
    this.name = 'FederationError';
    this.code = code; // invalidInput | notFound | unavailable
  }
}

function normalizeDomain(raw, maxLength = 253) {
  if (typeof raw !== 'string') return null;
  const trimmed = asciiTrim(raw);
  // ASCII check before lowercasing (JS would fold e.g. the Kelvin sign to 'k').
  if (!PRINTABLE_ASCII_RE.test(trimmed)) return null;
  const domain = trimmed.toLowerCase();
  if (domain.length > maxLength || !HOSTNAME_RE.test(domain)) return null;
  return domain;
}

/** Splits name*domain; null if it isn't a well-formed stellar address. */
function parseStellarAddress(raw) {
  if (typeof raw !== 'string') return null;
  const value = asciiTrim(raw);
  if (!value || value.length > MAX_ADDRESS_LENGTH || !PRINTABLE_ASCII_RE.test(value)) return null;
  const star = value.indexOf('*');
  if (star <= 0 || star !== value.lastIndexOf('*')) return null;
  const name = value.slice(0, star);
  const domain = normalizeDomain(value.slice(star + 1));
  if (!domain || name.length > MAX_NAME_LENGTH || !NAME_RE.test(name)) return null;
  return { name, domain, address: `${name}*${domain}` };
}

function tomlUrlFor(domain) {
  return `https://${domain}/.well-known/stellar.toml`;
}

/**
 * Top-level FEDERATION_SERVER = "..." (or '...') before the first [table].
 * Deliberately a small line parser rather than a full TOML parser, so the
 * PHP twin can apply exactly the same rules.
 */
function extractFederationServer(tomlText) {
  const text = String(tomlText ?? '').replace(/^\uFEFF/, '');
  if (/^\s*<(!doctype|html)/i.test(text)) return null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) break;
    const m = line.match(/^FEDERATION_SERVER\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/);
    if (m) return m[1] ?? m[2];
  }
  return null;
}

/**
 * https on port 443 only, printable ASCII (no IDN), no credentials, no query
 * string, no fragment, hostname (not IP) host. Rejecting an existing query
 * keeps Node and PHP from building different request URLs, and port 443
 * keeps the backend from being steered at arbitrary public ports.
 */
function validateFederationServerUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = asciiTrim(raw);
  if (!value || value.length > MAX_FEDERATION_SERVER_URL_LENGTH || !PRINTABLE_ASCII_RE.test(value)) return null;
  if (/[?#\\]/.test(value)) return null;
  // Any explicit port (even :443, which URL would normalize away) or
  // credentials ('@') in the authority is refused - same as PHP's parse_url check.
  if (/^https:\/\/[^/]*[:@]/i.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port !== '') return null;
  if (!normalizeDomain(url.hostname)) return null;
  // The validated raw value, not url.toString(): WHATWG normalisation (dot
  // segments, percent-encoding) would make Node request a different URL than PHP.
  return value;
}

/**
 * SSRF-safe GET: https only, no redirects (a 3xx is a failure, same as the
 * Stellar SDK's own stellar.toml resolver), timeout, size cap.
 */
async function safeFetchText(url, { accept, maxBytes }) {
  const parsed = assertSafeScheme(url);
  if (parsed.protocol !== 'https:') throw new Error('ssrf.blocked:scheme');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEDERATION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      headers: { accept, [HOP_HEADER]: '1' },
      signal: controller.signal,
      redirect: 'manual',
      dispatcher: ssrfSafeAgent,
    });
    if (response.status >= 300 && response.status < 400) throw new Error('federation.redirectNotAllowed');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await readTextWithLimit(response, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

async function loadFederationServer(domain, fetchText) {
  let tomlText;
  try {
    tomlText = await fetchText(tomlUrlFor(domain), { accept: 'text/plain, application/toml, */*', maxBytes: MAX_TOML_BYTES });
  } catch (error) {
    throw new FederationError(/^HTTP 404$/.test(String(error?.message)) ? 'notFound' : 'unavailable');
  }
  const server = validateFederationServerUrl(extractFederationServer(tomlText));
  if (!server) throw new FederationError('notFound');
  return server;
}

async function queryFederationServer(serverUrl, q, type, fetchText) {
  const url = new URL(serverUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('type', type);
  let text;
  try {
    text = await fetchText(url.toString(), { accept: 'application/json', maxBytes: MAX_FEDERATION_RESPONSE_BYTES });
  } catch (error) {
    throw new FederationError(/^HTTP 404$/.test(String(error?.message)) ? 'notFound' : 'unavailable');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FederationError('unavailable');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FederationError('unavailable');
  return data;
}

// C... und W... (SEP-23 muxed contract, Protocol 30 / CAP-84) per SDK, inkl. Checksumme.
// Gleiche Regel in api/federationService.php.
function isContractAddressId(id) {
  if (typeof id !== 'string') return false;
  return StellarSdk.StrKey.isValidContract(id) || StellarSdk.StrKey.isValidMuxedContract(id);
}

function isValidMemo(type, memo) {
  if (typeof memo !== 'string' || !memo) return false;
  if (type === 'text') return Buffer.byteLength(memo, 'utf8') <= 28;
  if (type === 'id') return /^\d{1,20}$/.test(memo) && BigInt(memo) <= UINT64_MAX;
  if (type === 'hash') return /^[A-Za-z0-9+/]{43}=$/.test(memo) && Buffer.from(memo, 'base64').length === 32;
  return false;
}

/**
 * Validates a type=name answer. A malformed memo rejects the whole record:
 * silently dropping it could send funds to an exchange without its memo.
 */
function validateNameRecord(data) {
  const accountId = data?.account_id;
  if (typeof accountId !== 'string' || !StellarSdk.StrKey.isValidEd25519PublicKey(accountId)) return null;
  const record = { account_id: accountId };
  const hasType = data.memo_type !== undefined && data.memo_type !== null && data.memo_type !== '';
  const hasMemo = data.memo !== undefined && data.memo !== null && data.memo !== '';
  if (!hasType && !hasMemo) return record;
  if (!hasType || !hasMemo || !MEMO_TYPES.has(data.memo_type)) return null;
  const memo = data.memo_type === 'id' && Number.isSafeInteger(data.memo) && data.memo >= 0 ? String(data.memo) : data.memo;
  if (!isValidMemo(data.memo_type, memo)) return null;
  record.memo_type = data.memo_type;
  record.memo = memo;
  return record;
}

/** Forward resolution name*domain -> account. Throws FederationError. */
async function resolveFederationName(rawAddress, { fetchText = safeFetchText } = {}) {
  const parsed = parseStellarAddress(rawAddress);
  if (!parsed) throw new FederationError('invalidInput');
  const server = await loadFederationServer(parsed.domain, fetchText);
  const data = await queryFederationServer(server, parsed.address, 'name', fetchText);
  // C-/W-Adressen (Contract, muxed Contract seit Protocol 30 / CAP-84) sind fuer klassische
  // Zahlungen kein gueltiges Ziel; eigener Code, damit die UI das klar sagen kann.
  if (isContractAddressId(data?.account_id)) throw new FederationError('contractAddress');
  const record = validateNameRecord(data);
  if (!record) throw new FederationError('unavailable');
  return { stellar_address: parsed.address, ...record };
}

/**
 * Reverse lookup account -> name, see the rules at the top of this file.
 * Returns { found: true, stellar_address, domain } or { found: false };
 * throws only for invalid input.
 */
async function reverseFederationLookup(accountId, { loadHomeDomain, fetchText = safeFetchText }) {
  const id = typeof accountId === 'string' ? asciiTrim(accountId) : '';
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(id)) throw new FederationError('invalidInput');
  const none = { found: false };
  try {
    const homeDomain = normalizeDomain(await loadHomeDomain(id), MAX_HOME_DOMAIN_LENGTH);
    if (!homeDomain) return none;
    const server = await loadFederationServer(homeDomain, fetchText);

    const reverse = await queryFederationServer(server, id, 'id', fetchText);
    if (reverse.account_id !== undefined && reverse.account_id !== id) return none;
    const parsed = parseStellarAddress(reverse.stellar_address);
    if (!parsed || parsed.domain !== homeDomain) return none;

    // Cross-check: forward resolution of the claimed name must point back
    // to exactly this account. Same domain, so the same FEDERATION_SERVER.
    const forward = validateNameRecord(await queryFederationServer(server, parsed.address, 'name', fetchText));
    if (!forward || forward.account_id !== id) return none;

    return { found: true, stellar_address: parsed.address, domain: homeDomain };
  } catch {
    return none;
  }
}

const STATUS_BY_CODE = { invalidInput: 400, notFound: 404, contractAddress: 422, loopDetected: 508, unavailable: 502 };

/**
 * Framework-free request handler, shared by server.js and the tests.
 * query: { type: 'name'|'id', q, network }.
 */
async function handleFederationRequest(query, { loadHomeDomain, fetchText = safeFetchText, incomingHop = false } = {}) {
  if (incomingHop) {
    return { status: STATUS_BY_CODE.loopDetected, body: { ok: false, error: 'federation.loopDetected' } };
  }
  // Strings only (an Express query can also be an array/object) - same as PHP.
  const type = typeof query?.type === 'string' ? query.type : '';
  const q = typeof query?.q === 'string' ? query.q : '';
  try {
    if (type === 'name') {
      return { status: 200, body: { ok: true, ...(await resolveFederationName(q, { fetchText })) } };
    }
    if (type === 'id') {
      return { status: 200, body: { ok: true, ...(await reverseFederationLookup(q, { loadHomeDomain, fetchText })) } };
    }
    throw new FederationError('invalidInput');
  } catch (error) {
    const code = error instanceof FederationError ? error.code : 'unavailable';
    return { status: STATUS_BY_CODE[code] || 502, body: { ok: false, error: `federation.${code}` } };
  }
}

module.exports = {
  FederationError,
  HOSTNAME_RE,
  HOP_HEADER,
  FEDERATION_FETCH_TIMEOUT_MS,
  MAX_TOML_BYTES,
  MAX_FEDERATION_RESPONSE_BYTES,
  normalizeDomain,
  isContractAddressId,
  parseStellarAddress,
  extractFederationServer,
  validateFederationServerUrl,
  validateNameRecord,
  safeFetchText,
  resolveFederationName,
  reverseFederationLookup,
  handleFederationRequest,
};
