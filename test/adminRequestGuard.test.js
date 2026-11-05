// G4: Aendernde Admin-Requests (Login, Logout, Bugreport-Update) nur von einer
// erlaubten Origin und, wenn sie einen Body haben, nur als application/json (Node).
// Prueft die Helfer in services/requestGuard.js direkt und den Ablauf per HTTP
// gegen einen gestarteten server.js. Pendant: test/adminRequestGuard.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isAllowedOrigin, isJsonContentType } = require('../services/requestGuard.js');

const PORT = 3925;
const BASE = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'g4-test-secret';
const GOOD_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'https://evil.steei.de';

// --- Helfer -----------------------------------------------------------------
test('isAllowedOrigin: nur exakte Eintraege der CORS-Allowlist', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedOrigin(EVIL_ORIGIN), false);
  assert.equal(isAllowedOrigin('http://localhost:5173/'), false);
  assert.equal(isAllowedOrigin('http://localhost:51730'), false);
  assert.equal(isAllowedOrigin('null'), false);
  assert.equal(isAllowedOrigin(''), false);
  assert.equal(isAllowedOrigin(undefined), false);
});

test('isJsonContentType: application/json mit Parametern und beliebiger Schreibung', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('Application/JSON;charset=UTF-8'), true);
  assert.equal(isJsonContentType(' application/json '), true);
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType('text/plain; charset=application/json'), false);
  assert.equal(isJsonContentType('application/x-www-form-urlencoded'), false);
  assert.equal(isJsonContentType('multipart/form-data; boundary=x'), false);
  assert.equal(isJsonContentType('application/jsonp'), false);
  assert.equal(isJsonContentType(''), false);
  assert.equal(isJsonContentType(undefined), false);
});

// --- HTTP gegen server.js -----------------------------------------------------
let server;
let dataDir;
let bugDbPath;

const storedReport = () => JSON.parse(fs.readFileSync(bugDbPath, 'utf8')).items.find((r) => r.id === 1);

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-g4-'));
  bugDbPath = path.join(dataDir, 'bugreports.json');
  fs.writeFileSync(bugDbPath, JSON.stringify({ lastId: 1, items: [{
    id: 1, ts: new Date().toISOString(), url: 'https://example.test', title: 'Seed', status: 'open', priority: 'normal',
    category: 'bug', page: 'other', contactEmail: 'seed@example.test', rejectionReason: null, comment: null,
  }] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, BUG_DB_PATH: bugDbPath, BUGTRACKER_ADMIN_SECRET: SECRET },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${BASE}/admin/check`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Schickt einen Request mit frei waehlbarer Origin (null = kein Origin-Header).
async function send(method, url, { origin = GOOD_ORIGIN, contentType = 'application/json', body, cookie } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (body !== undefined && contentType) headers['content-type'] = contentType;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: setCookie ? setCookie.split(';')[0] : null };
}

const isAuthenticated = async (cookie) => (await send('GET', `${BASE}/admin/check`, { cookie })).body.authenticated;

async function login() {
  const res = await send('POST', `${BASE}/admin/login`, { body: { secret: SECRET } });
  assert.equal(res.status, 200);
  assert.ok(res.cookie, 'Login setzt ein Session-Cookie');
  return res.cookie;
}

test('Login: fremde Origin mit richtigem Secret ergibt 403 forbidden_origin und keine Session', async () => {
  const res = await send('POST', `${BASE}/admin/login`, { origin: EVIL_ORIGIN, body: { secret: SECRET } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden_origin');
  assert.equal(res.cookie, null);
});

test('Login: fehlende Origin ergibt 403 forbidden_origin', async () => {
  const res = await send('POST', `${BASE}/admin/login`, { origin: null, body: { secret: SECRET } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden_origin');
  assert.equal(res.cookie, null);
});

test('Login: text/plain mit gueltigem JSON ergibt 415 unsupported_media_type und keine Session', async () => {
  const res = await send('POST', `${BASE}/admin/login`, { contentType: 'text/plain', body: { secret: SECRET } });
  assert.equal(res.status, 415);
  assert.equal(res.body.error, 'unsupported_media_type');
  assert.equal(res.cookie, null);
});

test('Login: erlaubte Origin und JSON (mit charset) funktioniert wie bisher', async () => {
  const res = await send('POST', `${BASE}/admin/login`, { contentType: 'application/json; charset=utf-8', body: { secret: SECRET } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(await isAuthenticated(res.cookie), true);
});

test('Login: falsches Secret von erlaubter Origin bleibt 401', async () => {
  const res = await send('POST', `${BASE}/admin/login`, { body: { secret: 'falsch' } });
  assert.equal(res.status, 401);
});

test('Update: fremde Origin ergibt 403 forbidden_origin, Bugreport unveraendert', async () => {
  const cookie = await login();
  const res = await send('PATCH', `${BASE}/bugreport/1`, { origin: EVIL_ORIGIN, cookie, body: { status: 'closed', contactEmail: 'evil@example.test' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden_origin');
  assert.equal(storedReport().status, 'open');
  assert.equal(storedReport().contactEmail, 'seed@example.test');
});

test('Update: fehlende Origin ergibt 403 forbidden_origin, Bugreport unveraendert', async () => {
  const cookie = await login();
  const res = await send('PATCH', `${BASE}/bugreport/1`, { origin: null, cookie, body: { status: 'closed' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden_origin');
  assert.equal(storedReport().status, 'open');
});

test('Update: text/plain mit gueltigem JSON ergibt 415, Bugreport unveraendert', async () => {
  const cookie = await login();
  const res = await send('PATCH', `${BASE}/bugreport/1`, { contentType: 'text/plain', cookie, body: { status: 'closed' } });
  assert.equal(res.status, 415);
  assert.equal(res.body.error, 'unsupported_media_type');
  assert.equal(storedReport().status, 'open');
});

test('Update: fremde Origin ohne Session ergibt 403 forbidden_origin vor der Admin-Pruefung', async () => {
  const res = await send('PATCH', `${BASE}/bugreport/1`, { origin: EVIL_ORIGIN, body: { status: 'closed' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden_origin');
});

test('Update: erlaubte Origin und JSON funktioniert wie bisher', async () => {
  const cookie = await login();
  const res = await send('PATCH', `${BASE}/bugreport/1`, { cookie, body: { status: 'in_progress' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(storedReport().status, 'in_progress');
});

test('Logout: fremde und fehlende Origin ergeben 403 forbidden_origin, Session bleibt', async () => {
  const cookie = await login();
  for (const origin of [EVIL_ORIGIN, null]) {
    const res = await send('POST', `${BASE}/admin/logout`, { origin, cookie });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden_origin');
  }
  assert.equal(await isAuthenticated(cookie), true);
});

test('Logout: erlaubte Origin ohne Body funktioniert wie bisher', async () => {
  const cookie = await login();
  const res = await send('POST', `${BASE}/admin/logout`, { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(await isAuthenticated(cookie), false);
});

test('Oeffentliches Anlegen eines Bugreports funktioniert unveraendert, auch ohne Origin', async () => {
  const res = await send('POST', `${BASE}/bugreport`, { origin: null, body: { title: 'Neu', url: 'https://example.test/neu' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const created = JSON.parse(fs.readFileSync(bugDbPath, 'utf8')).items.find((r) => r.id === res.body.id);
  assert.equal(created.title, 'Neu');
});
