// R-8: Rate-Limit fuer GET /api/multisig/jobs (services/rateLimit.js), gleiches Budget wie
// api/multisigJobsGuard.php laut test/assets/rate-limits.json. In-process gegen eine kleine
// Express-App (trust proxy 'loopback', X-Forwarded-For setzt die Client-IP) fuer Budget,
// Antwort und IPv6 je /64; danach die Einbindung in server.js ueber einen eigenen Server.
// Der globale Limiter (100 je 15 min) liesse 100 Listenabrufe zu, darum der eigene Limiter.
// Pendant: test/rateLimitAreas.test.php und test/rateLimitRoutes.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createJobListLimiter, JOB_LIST_RATE_LIMIT_MAX, JOB_LIST_RATE_LIMIT_WINDOW_MS } = require('../services/rateLimit.js');
const limits = require('./assets/rate-limits.json');

const area = limits.areas.jobList;
const PORT = 3974;

let app;
let base;
let server;
let dataDir;

test.before(async () => {
  const mini = express();
  mini.set('trust proxy', 'loopback');
  mini.get('/jobs', createJobListLimiter(), (req, res) => res.json([]));
  await new Promise((resolve) => { app = mini.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${app.address().port}/jobs`;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-job-list-limit-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/admin/check`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  app?.close();
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const hit = async (url, ip) => {
  const r = await fetch(url, { headers: ip ? { 'x-forwarded-for': ip } : {} });
  return { status: r.status, retryAfterHeader: r.headers.get('retry-after'), body: await r.json().catch(() => ({})) };
};

const assertLimited = (res) => {
  assert.equal(res.status, area.status);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, area.error);
  assert.ok(Number.isInteger(res.body.retryAfter) && res.body.retryAfter >= 1 && res.body.retryAfter <= area.windowSeconds);
  assert.equal(res.retryAfterHeader, String(res.body.retryAfter));
};

test('Budget wie in PHP (Fixture)', () => {
  assert.equal(JOB_LIST_RATE_LIMIT_MAX, area.max);
  assert.equal(JOB_LIST_RATE_LIMIT_WINDOW_MS, area.windowSeconds * 1000);
});

test('nach dem Budget 429 too_many_requests mit retryAfter, andere IP eigenes Budget', async () => {
  for (let i = 0; i < area.max; i += 1) assert.equal((await hit(base, '198.51.100.7')).status, 200);
  assertLimited(await hit(base, '198.51.100.7'));
  assert.equal((await hit(base, '198.51.100.8')).status, 200);
});

test('IPv6-Adressen aus derselben /64 teilen ein Budget', async () => {
  for (let i = 0; i < area.max; i += 1) {
    assert.equal((await hit(base, `2001:db8:1:2::${(i + 1).toString(16)}`)).status, 200);
  }
  assertLimited(await hit(base, '2001:db8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal((await hit(base, '2001:db8:1:3::1')).status, 200, 'naechstes /64 hat eigenes Budget');
});

test('server.js: globaler und Federation-Limiter zaehlen IPv6 je /64 wie PHP (Default der Bibliothek /56)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const limiter = rateLimit\(\{[^}]*ipv6Subnet: 64,/);
  assert.match(src, /const federationLimiter = rateLimit\(\{[^}]*ipv6Subnet: 64,/);
});

test('server.js: Liste ist begrenzt, gezaehlt wird vor der Pruefung auf accountId oder signer', async () => {
  const listUrl = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
  for (let i = 0; i < area.max; i += 1) {
    const url = i % 2 === 0 ? listUrl : `${listUrl}?network=testnet&accountId=GABC`;
    assert.notEqual((await hit(url)).status, 429, `Anfrage ${i + 1}`);
  }
  assertLimited(await hit(`${listUrl}?network=testnet&accountId=GABC`));
});
