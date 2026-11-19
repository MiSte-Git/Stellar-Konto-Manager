// Rate-Limit und Route GET /api/trade/assets/logo. Budget laut test/assets/rate-limits.json (assetLogo), gleich
// wie api/assetLogo.php. In-process gegen eine kleine Express-App (trust proxy 'loopback', X-Forwarded-For setzt
// die Client-IP) fuer Budget und IPv6 je /64; danach server.js: ungueltige Eingabe 400 ohne Cache, gezaehlt
// wird vor der Pruefung, nach dem Budget 429. Ungueltige Eingaben loesen keinen Abruf nach aussen aus.
// Pendant: test/rateLimitAreas.test.php und test/rateLimitRoutes.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createAssetLogoLimiter, ASSET_LOGO_RATE_LIMIT_MAX, ASSET_LOGO_RATE_LIMIT_WINDOW_MS } = require('../services/rateLimit.js');
const limits = require('./assets/rate-limits.json');

const area = limits.areas.assetLogo;
const PORT = 3976;

let app;
let base;
let server;
let dataDir;

test.before(async () => {
  const mini = express();
  mini.set('trust proxy', 'loopback');
  mini.get('/logo', createAssetLogoLimiter(), (req, res) => res.status(404).json({ ok: false }));
  await new Promise((resolve) => { app = mini.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${app.address().port}/logo`;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-asset-logo-limit-'));
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
  return {
    status: r.status,
    retryAfterHeader: r.headers.get('retry-after'),
    cacheControl: r.headers.get('cache-control'),
    body: await r.json().catch(() => ({})),
  };
};

const assertLimited = (res) => {
  assert.equal(res.status, area.status);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, area.error);
  const retryAfter = Number(res.retryAfterHeader);
  assert.ok(retryAfter >= 1 && retryAfter <= area.windowSeconds);
  if (area.retryAfterInBody) assert.equal(res.body.retryAfter, retryAfter);
};

test('Budget wie in der Fixture', () => {
  assert.equal(ASSET_LOGO_RATE_LIMIT_MAX, area.max);
  assert.equal(ASSET_LOGO_RATE_LIMIT_WINDOW_MS, area.windowSeconds * 1000);
});

test('max Anfragen frei, die naechste 429, andere IPv4 eigenes Budget', async () => {
  for (let i = 0; i < area.max; i += 1) assert.equal((await hit(base, '198.51.100.40')).status, 404);
  assertLimited(await hit(base, '198.51.100.40'));
  assert.equal((await hit(base, '198.51.100.41')).status, 404);
});

test('IPv6 im selben /64 teilt ein Budget, anderes /64 nicht', async () => {
  for (let i = 0; i < area.max; i += 1) await hit(base, `2001:db8:5:6::${(i + 1).toString(16)}`);
  assertLimited(await hit(base, '2001:db8:5:6:ffff:ffff:ffff:ffff'));
  assert.equal((await hit(base, '2001:db8:5:7::1')).status, 404);
});

test('server.js: Hop-Header und Sec-Fetch-Dest ausser image vor dem Limiter abgewiesen, kein Budget verbraucht', async () => {
  const url = `http://127.0.0.1:${PORT}/api/trade/assets/logo?code=!!&issuer=GABC&network=testnet`;
  const get = async (headers) => {
    const r = await fetch(url, { headers });
    return { status: r.status, cacheControl: r.headers.get('cache-control'), body: await r.json().catch(() => ({})) };
  };
  for (let i = 0; i < 3; i += 1) {
    const hop = await get({ 'x-skm-logo-hop': '1', 'sec-fetch-dest': 'image' });
    assert.deepEqual([hop.status, hop.body.error, hop.cacheControl], [404, 'assetLogo.hopRefused', 'no-store']);
    const doc = await get({ 'sec-fetch-dest': 'document' });
    assert.deepEqual([doc.status, doc.body.error, doc.cacheControl], [404, 'assetLogo.notImageRequest', 'no-store']);
    const post = await fetch(url, { method: 'POST' });
    assert.equal(post.status, 404);
  }
  // Ein Aufruf mit image zaehlt (der Budget-Test unten rechnet ihn ein).
  assert.equal((await get({ 'sec-fetch-dest': 'image' })).status, 400);
});

test('server.js: ungueltige Eingabe 400 no-store, gezaehlt vor der Pruefung, danach 429 no-store', async () => {
  const url = `http://127.0.0.1:${PORT}/api/trade/assets/logo?code=!!&issuer=GABC&network=testnet`;
  const first = await hit(url);
  assert.equal(first.status, 400);
  assert.equal(first.body.error, 'assetSearch.invalidInput:codeInvalid');
  assert.equal(first.cacheControl, 'no-store');
  // max - 2: einer im Test oben (Sec-Fetch-Dest image), einer hier (first)
  for (let i = 2; i < area.max; i += 1) assert.equal((await hit(url)).status, 400);
  const limited = await hit(url);
  assertLimited(limited);
  assert.equal(limited.cacheControl, 'no-store');
});
