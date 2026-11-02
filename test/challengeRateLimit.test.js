// C2: eigenes Rate-Limit fuer POST /challenge (services/challengeRateLimit.js), in-process
// gegen eine kleine Express-App. Mit trust proxy 'loopback' setzt X-Forwarded-For die
// Client-IP, so lassen sich IPv4- und IPv6-Clients simulieren.
// Pendant: test/rateLimit.test.php. Die Einbindung in server.js prueft
// test/multisigDecline.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createChallengeLimiter } = require('../services/challengeRateLimit.js');
const { CHALLENGE_RATE_LIMIT_MAX } = require('../services/challengeStore.js');

let server;
let base;

test.before(async () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.post('/challenge', createChallengeLimiter(), (req, res) => res.json({ ok: true }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/challenge`;
});

test.after(() => server?.close());

const hit = async (ip) => {
  const r = await fetch(base, { method: 'POST', headers: { 'x-forwarded-for': ip } });
  return { status: r.status, retryAfterHeader: r.headers.get('retry-after'), body: await r.json().catch(() => ({})) };
};

test('Budget ist 20 pro Minute, wie in PHP', () => {
  assert.equal(CHALLENGE_RATE_LIMIT_MAX, 20);
});

test('die 21. Anfrage innerhalb der Minute ergibt 429 mit retryAfter', async () => {
  for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX; i += 1) assert.equal((await hit('198.51.100.7')).status, 200);
  const res = await hit('198.51.100.7');
  assert.equal(res.status, 429);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'too_many_requests');
  assert.ok(Number.isInteger(res.body.retryAfter) && res.body.retryAfter >= 1 && res.body.retryAfter <= 60);
  assert.equal(res.retryAfterHeader, String(res.body.retryAfter));
  assert.equal((await hit('198.51.100.8')).status, 200, 'andere IP hat eigenes Budget');
});

test('IPv6-Adressen aus derselben /64 teilen ein Budget', async () => {
  for (let i = 0; i < CHALLENGE_RATE_LIMIT_MAX; i += 1) {
    assert.equal((await hit(`2001:db8:1:2::${(i + 1).toString(16)}`)).status, 200);
  }
  assert.equal((await hit('2001:db8:1:2:ffff::1')).status, 429);
  assert.equal((await hit('2001:db8:1:3::1')).status, 200, 'naechstes /64 hat eigenes Budget');
});
