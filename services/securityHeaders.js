// Single source of truth for SKM's security headers (Backlog P1.2).
//
// Used by:
// - frontend/vite.config.js: renders dist/.htaccess from
//   frontend/.htaccess.template at build time (Apache on cyon) and sets the
//   same headers for `vite preview`, so the production CSP can be tested
//   locally via `npm run build && npm run preview`.
// - server.js: API headers for the Node backend (local development).
// - api/securityHeaders.php mirrors the API values for the PHP backend;
//   test/securityHeaders.test.js checks that both stay identical.
//
// Why a strict CSP: XSS is SKM's main attack vector - secret keys live in the
// browser during a session (see frontend/src/utils/sessionSecrets.js).
// script-src 'self' blocks injected script, a narrow connect-src blocks
// fetch()/XHR/EventSource/WebSocket exfiltration to foreign hosts. It does
// NOT block top-level navigation (location.href = ...) - CSP has no
// directive for that.
//
// The Vite dev server deliberately gets no CSP (HMR needs inline script and a
// WebSocket).

// Every host the frontend talks to directly. Federation (SEP-2) and
// stellar.toml lookups of arbitrary domains deliberately go through our own
// backend (/api/federation) so connect-src can stay this narrow.
const BASE_CONNECT_SRC = Object.freeze([
  "'self'", // own API (/api/*), build-info.json, Vite preview proxy (/horizon)
  'https://horizon.stellar.org',
  'https://horizon-testnet.stellar.org',
  'https://friendbot.stellar.org', // testnet activation (story, scam simulator, multisig create)
  'https://api.coingecko.com', // XLM price display (useXlmPrice.js)
]);

// Backlog P2.1 (QR scan): camera=(self), only SKM's own origin may use the camera
// (no third-party frames). Microphone and geolocation stay disabled.
const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=()';
const REFERRER_POLICY = 'strict-origin-when-cross-origin';
// No includeSubDomains (other steei.de subdomains are not ours to pin), no preload.
const HSTS = 'max-age=31536000';
// JSON responses need no full CSP - nothing renders, nothing may frame them.
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Origin of an absolute http(s) URL, or null (relative URL, garbage, other scheme).
 * includeLocal=false drops localhost origins - the production .htaccess must
 * never allow them (apiBase.js maps a localhost VITE_BACKEND_URL to /api
 * anyway when the page itself isn't on localhost).
 */
function originOf(url, { includeLocal = true } = {}) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (!includeLocal && isLocalHostname(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Extra connect-src origins derived from the build env (absolute
 * VITE_BACKEND_URL / VITE_HORIZON_URL). Relative values are covered by 'self'.
 */
function extraConnectSrcFromEnv(env = {}, { includeLocal = false } = {}) {
  return [env.VITE_BACKEND_URL, env.VITE_HORIZON_URL]
    .map((value) => originOf(value, { includeLocal }))
    .filter(Boolean);
}

function buildFrontendCsp({ extraConnectSrc = [] } = {}) {
  const connectSrc = [...new Set([...BASE_CONNECT_SRC, ...extraConnectSrc])];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:", // data: for SVGs Vite inlines (flag-icons)
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:", // canvas-confetti runs its renderer in a blob: worker
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function cspHeaderName(reportOnly) {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/**
 * Headers for the frontend (HTML/assets). HSTS is left out here on purpose:
 * the .htaccess template sets it only for HTTPS requests, and `vite preview`
 * runs on plain http://localhost.
 */
function frontendHeaders({ extraConnectSrc = [], reportOnly = false } = {}) {
  return {
    [cspHeaderName(reportOnly)]: buildFrontendCsp({ extraConnectSrc }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', // legacy twin of frame-ancestors 'none'
    'Referrer-Policy': REFERRER_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY,
  };
}

function apiHeaders() {
  return {
    'Content-Security-Policy': API_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': REFERRER_POLICY,
  };
}

/** Express middleware: API headers on every response, HSTS only over HTTPS. */
function createApiSecurityHeadersMiddleware() {
  const headers = apiHeaders();
  return function apiSecurityHeaders(req, res, next) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (req.secure) res.setHeader('Strict-Transport-Security', HSTS);
    next();
  };
}

/**
 * Fills frontend/.htaccess.template. base is the URL path without trailing
 * slash ('' for a root deploy, '/SKM_Canary' for the canary).
 */
function renderHtaccess(template, { base = '', extraConnectSrc = [], reportOnly = false } = {}) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  if (/[\s"'#]/.test(normalizedBase)) throw new Error(`htaccess template: unsupported base ${normalizedBase}`);
  const replacements = {
    // __BASE_REGEX__ first: __BASE__ is a substring of it.
    __BASE_REGEX__: normalizedBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    __BASE__: normalizedBase,
    __CSP_HEADER__: cspHeaderName(reportOnly),
    __CSP__: buildFrontendCsp({ extraConnectSrc }),
    __PERMISSIONS_POLICY__: PERMISSIONS_POLICY,
    __REFERRER_POLICY__: REFERRER_POLICY,
    __HSTS__: HSTS,
  };
  let out = String(template);
  for (const [key, value] of Object.entries(replacements)) out = out.split(key).join(value);
  const leftover = out.match(/__[A-Z_]+__/);
  if (leftover) throw new Error(`htaccess template: unresolved placeholder ${leftover[0]}`);
  return out;
}

module.exports = {
  BASE_CONNECT_SRC,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  HSTS,
  API_CSP,
  originOf,
  extraConnectSrcFromEnv,
  buildFrontendCsp,
  cspHeaderName,
  frontendHeaders,
  apiHeaders,
  createApiSecurityHeadersMiddleware,
  renderHtaccess,
};
