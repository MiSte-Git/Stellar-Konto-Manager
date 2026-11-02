// Rate-Limit fuer POST /api/multisig/jobs/:id/challenge (C2), zusaetzlich zum globalen
// Limiter in server.js. Gleiches Budget und gleiche Antwort wie in api/multisig.php:
// 429 { ok: false, error: 'too_many_requests', retryAfter } plus Header Retry-After.
// IPv6 zaehlt je /64 wie api/rateLimit.php. Als Fabrik, damit Tests eine eigene Instanz
// mit eigenem Speicher bekommen.
const rateLimit = require('express-rate-limit');
const { CHALLENGE_RATE_LIMIT_MAX, CHALLENGE_RATE_LIMIT_WINDOW_MS } = require('./challengeStore.js');

function createChallengeLimiter() {
  return rateLimit({
    windowMs: CHALLENGE_RATE_LIMIT_WINDOW_MS,
    limit: CHALLENGE_RATE_LIMIT_MAX,
    ipv6Subnet: 64,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + CHALLENGE_RATE_LIMIT_WINDOW_MS;
      const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ ok: false, error: 'too_many_requests', retryAfter });
    },
  });
}

module.exports = { createChallengeLimiter };
