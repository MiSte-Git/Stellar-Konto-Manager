// Rate-Limit fuer POST /api/multisig/jobs/:id/challenge (C2), zusaetzlich zum globalen
// Limiter in server.js. Gleiches Budget und gleiche Antwort wie in api/multisig.php:
// 429 { ok: false, error: 'too_many_requests', retryAfter } plus Header Retry-After.
// IPv6 zaehlt je /64 wie api/rateLimit.php. Als Fabrik, damit Tests eine eigene Instanz
// mit eigenem Speicher bekommen.
const { createJsonRateLimiter } = require('./rateLimit.js');
const { CHALLENGE_RATE_LIMIT_MAX, CHALLENGE_RATE_LIMIT_WINDOW_MS } = require('./challengeStore.js');

function createChallengeLimiter() {
  return createJsonRateLimiter({ windowMs: CHALLENGE_RATE_LIMIT_WINDOW_MS, limit: CHALLENGE_RATE_LIMIT_MAX });
}

module.exports = { createChallengeLimiter };
