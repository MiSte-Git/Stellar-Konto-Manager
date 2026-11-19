// Rate-Limiter je IP mit derselben Antwort wie api/rateLimit.php: 429
// { ok: false, error: 'too_many_requests', retryAfter } plus Header Retry-After. IPv6 zaehlt
// je /64 wie in PHP. Als Fabrik, damit Tests eine eigene Instanz mit eigenem Speicher bekommen.
// Der globale Limiter in server.js gilt zusaetzlich.
const rateLimit = require('express-rate-limit');

function createJsonRateLimiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    ipv6Subnet: 64,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + windowMs;
      const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ ok: false, error: 'too_many_requests', retryAfter });
    },
  });
}

// R-8: GET /api/multisig/jobs (Liste), gleiches Budget wie MULTISIG_JOB_LIST_RATE_LIMIT_* in
// api/multisigJobsGuard.php. Begruendung dort: das Frontend pollt nicht, eine Ladung sind
// hoechstens 2 Anfragen.
const JOB_LIST_RATE_LIMIT_MAX = 60;
const JOB_LIST_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function createJobListLimiter() {
  return createJsonRateLimiter({ windowMs: JOB_LIST_RATE_LIMIT_WINDOW_MS, limit: JOB_LIST_RATE_LIMIT_MAX });
}

// GET /api/trade/assets/logo, gleiches Budget wie ASSET_LOGO_RATE_LIMIT_* in api/assetLogo.php. Jede Anfrage
// kann bis zu drei Abrufe nach aussen ausloesen (Horizon, stellar.toml, Bild), darum ein eigenes Budget.
const ASSET_LOGO_RATE_LIMIT_MAX = 60;
const ASSET_LOGO_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function createAssetLogoLimiter() {
  return createJsonRateLimiter({ windowMs: ASSET_LOGO_RATE_LIMIT_WINDOW_MS, limit: ASSET_LOGO_RATE_LIMIT_MAX });
}

module.exports = {
  createJsonRateLimiter,
  createJobListLimiter,
  JOB_LIST_RATE_LIMIT_MAX,
  JOB_LIST_RATE_LIMIT_WINDOW_MS,
  createAssetLogoLimiter,
  ASSET_LOGO_RATE_LIMIT_MAX,
  ASSET_LOGO_RATE_LIMIT_WINDOW_MS,
};
