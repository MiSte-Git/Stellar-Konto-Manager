// Shared CORS origin allowlist for server.js (finding #9). Single source of
// truth for which frontend origins may call cookie-/token-protected routes
// cross-origin (was previously a wildcard '*' — finding B3), so the two
// restricted route groups (multisig, admin+bugreport) can't drift apart.
function deriveOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

const ALLOWED_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.PROD_ORIGIN,
  deriveOrigin(process.env.PROD_API_URL),
].filter(Boolean));

/**
 * Builds an Express middleware that sets Access-Control-Allow-Origin only for
 * allowlisted origins (removing any reflected wildcard from a preceding
 * `cors({ origin: true })`), plus the given methods/headers, and short-
 * circuits OPTIONS preflights with 200.
 */
function createCorsMiddleware({ methods, headers, credentials = false }) {
  const methodsHeader = methods.join(',');
  const headersHeader = headers.join(', ');
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_APP_ORIGINS.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      if (credentials) res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Vary', 'Origin');
    } else {
      res.removeHeader('Access-Control-Allow-Origin');
    }
    res.header('Access-Control-Allow-Headers', headersHeader);
    res.header('Access-Control-Allow-Methods', methodsHeader);
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  };
}

module.exports = { ALLOWED_APP_ORIGINS, createCorsMiddleware };
