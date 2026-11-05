// G3: Fremde Origins werden in server.js mit 403 forbidden_origin abgewiesen,
// bevor express.json() oder ein Handler laeuft, auch beim Preflight. Requests
// ohne Origin-Header und von erlaubten Origins laufen wie bisher. Prueft per
// HTTP gegen einen gestarteten server.js. Pendant: test/corsReject.test.php.
// Die Normalisierung von PROD_ORIGIN pruefen die Unit-Tests in
// test/corsConfig.test.js; hier nur, dass server.js sie verwendet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3928;
const ROOT = `http://127.0.0.1:${PORT}`;
const BASE = `${ROOT}/api`;
const SECRET = 'g3-test-secret';
const GOOD_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'https://evil.steei.de';
// PROD_ORIGIN absichtlich mit Grossbuchstaben, Pfad und Slash (G4-2).
const PROD_ORIGIN_RAW = 'https://Admin.Example.Test/skm/';
const PROD_ORIGIN = 'https://admin.example.test';

let server;
let dataDir;
let bugDbPath;
let multisigDbPath;

const bugItems = () => JSON.parse(fs.readFileSync(bugDbPath, 'utf8')).items;
const multisigFileState = () => (fs.existsSync(multisigDbPath) ? fs.readFileSync(multisigDbPath, 'utf8') : null);

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-g3-'));
  bugDbPath = path.join(dataDir, 'bugreports.json');
  multisigDbPath = path.join(dataDir, 'multisig_jobs.json');
  fs.writeFileSync(bugDbPath, JSON.stringify({ lastId: 1, items: [{
    id: 1, ts: new Date().toISOString(), url: 'https://example.test', title: 'Seed', status: 'open', priority: 'normal',
    category: 'bug', page: 'other', contactEmail: 'seed@example.test', rejectionReason: null, comment: null,
  }] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      BUG_DB_DIR: dataDir,
      BUG_DB_PATH: bugDbPath,
      MULTISIG_DB_PATH: multisigDbPath,
      BUGTRACKER_ADMIN_SECRET: SECRET,
      ENABLE_COMPOSE_MAIL: '0',
      PROD_ORIGIN: PROD_ORIGIN_RAW,
    },
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

// origin null = kein Origin-Header. body ist roher Text.
async function send(method, url, { origin = GOOD_ORIGIN, contentType, body, cookie, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (origin !== null) headers.origin = origin;
  if (contentType) headers['content-type'] = contentType;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(url, { method, headers, body });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body: json, headers: r.headers, cookie: setCookie ? setCookie.split(';')[0] : null };
}

const jsonText = (obj) => JSON.stringify(obj);
const assertForbidden = (res, label) => {
  assert.equal(res.status, 403, label);
  assert.deepEqual(res.body, { ok: false, error: 'forbidden_origin' }, label);
  assert.equal(res.headers.get('access-control-allow-origin'), null, label);
  assert.equal(res.headers.get('access-control-allow-credentials'), null, label);
};

test('fremde Origin: POST mit text/plain auf Bugreport-Anlegen ergibt 403, kein Report angelegt', async () => {
  const before = bugItems().length;
  const res = await send('POST', `${BASE}/bugreport`, {
    origin: EVIL_ORIGIN, contentType: 'text/plain', body: jsonText({ title: 'CSRF', url: 'https://evil.test' }),
  });
  assertForbidden(res, 'bugreport create');
  assert.equal(bugItems().length, before);
});

test('fremde Origin: POST mit text/plain auf Multisig-Challenge ergibt 403, Handler laeuft nicht', async () => {
  const res = await send('POST', `${BASE}/multisig/jobs/unbekannt/challenge`, {
    origin: EVIL_ORIGIN, contentType: 'text/plain', body: jsonText({ signer: 'G'.padEnd(56, 'A') }),
  });
  assertForbidden(res, 'challenge');
  // Gegenprobe: von erlaubter Origin erreicht derselbe Request den Handler (404 not_found).
  const allowed = await send('POST', `${BASE}/multisig/jobs/unbekannt/challenge`, {
    contentType: 'application/json', body: jsonText({ signer: 'G'.padEnd(56, 'A') }),
  });
  assert.equal(allowed.status, 404);
  assert.equal(allowed.body.error, 'not_found');
});

test('fremde Origin: POST mit text/plain auf Multisig-Job-Anlegen ergibt 403, keine Jobdatei geschrieben', async () => {
  const before = multisigFileState();
  const res = await send('POST', `${BASE}/multisig/jobs`, {
    origin: EVIL_ORIGIN, contentType: 'text/plain', body: jsonText({ network: 'testnet', accountId: 'x', txXdr: 'x' }),
  });
  assertForbidden(res, 'multisig create');
  assert.equal(multisigFileState(), before);
});

test('fremde Origin: Trade-Suche und weitere Routen der globalen Middleware ergeben 403', async () => {
  for (const url of [`${BASE}/trade/assets/search?code=!!`, `${BASE}/federation?type=name&q=x`, `${ROOT}/trustlines`, `${BASE}/admin/check`, `${BASE}/bugreport`]) {
    assertForbidden(await send('GET', url, { origin: EVIL_ORIGIN }), url);
  }
  // Gegenprobe: erlaubte Origin erreicht den Trade-Handler (400 wegen ungueltigem Code).
  const allowed = await send('GET', `${BASE}/trade/assets/search?code=!!`);
  assert.equal(allowed.status, 400);
});

test('fremde Origin: "null" und leerer Origin-Header werden ebenfalls abgewiesen', async () => {
  for (const origin of ['null', '', 'https://skm.steei.de.evil.test', 'http://skm.steei.de', 'http://localhost:5174']) {
    assertForbidden(await send('POST', `${BASE}/bugreport`, { origin, contentType: 'text/plain', body: '{}' }), origin);
  }
});

test('fremde Origin: OPTIONS-Preflight ergibt 403 auf allen Routengruppen', async () => {
  for (const url of [`${BASE}/multisig/jobs`, `${BASE}/bugreport`, `${BASE}/admin/login`, `${BASE}/trade/assets/search`]) {
    const res = await send('OPTIONS', url, {
      origin: EVIL_ORIGIN, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assertForbidden(res, url);
  }
});

test('G4-1: fremde Origin plus text/plain beim Bugreport-Update ergibt 403, Report unveraendert', async () => {
  const login = await send('POST', `${BASE}/admin/login`, { contentType: 'application/json', body: jsonText({ secret: SECRET }) });
  assert.equal(login.status, 200);
  const res = await send('PATCH', `${BASE}/bugreport/1`, {
    origin: EVIL_ORIGIN, contentType: 'text/plain', cookie: login.cookie, body: jsonText({ status: 'closed' }),
  });
  assertForbidden(res, 'update');
  // Ohne Origin plus text/plain: Origin-Pruefung zuerst (403, nicht 415), gleich wie PHP.
  const noOrigin = await send('PATCH', `${BASE}/bugreport/1`, {
    origin: null, contentType: 'text/plain', cookie: login.cookie, body: jsonText({ status: 'closed' }),
  });
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.body.error, 'forbidden_origin');
  assert.equal(bugItems().find((r) => r.id === 1).status, 'open');
});

test('erlaubte Origin: Preflight mit CORS-Header, Credentials nur bei Admin/Bugreport', async () => {
  const pre = { headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } };
  const bug = await send('OPTIONS', `${BASE}/bugreport`, pre);
  assert.equal(bug.status, 200);
  assert.equal(bug.headers.get('access-control-allow-origin'), GOOD_ORIGIN);
  assert.equal(bug.headers.get('access-control-allow-credentials'), 'true');
  assert.match(bug.headers.get('access-control-allow-methods'), /PATCH/);

  const ms = await send('OPTIONS', `${BASE}/multisig/jobs`, pre);
  assert.equal(ms.status, 200);
  assert.equal(ms.headers.get('access-control-allow-origin'), GOOD_ORIGIN);
  assert.equal(ms.headers.get('access-control-allow-credentials'), null);
  assert.match(ms.headers.get('access-control-allow-headers'), /x-job-token/);

  const trade = await send('OPTIONS', `${BASE}/trade/assets/search`, pre);
  assert.equal(trade.status, 200);
  assert.equal(trade.headers.get('access-control-allow-origin'), GOOD_ORIGIN);
});

test('erlaubte Origin: Bugreport anlegen funktioniert wie bisher, mit CORS-Header und Credentials', async () => {
  const res = await send('POST', `${BASE}/bugreport`, { contentType: 'application/json', body: jsonText({ title: 'Ok', url: 'https://example.test/ok' }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers.get('access-control-allow-origin'), GOOD_ORIGIN);
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(bugItems().some((r) => r.id === res.body.id), true);
});

test('ohne Origin-Header: Anlegen, Admin-Check und Trade laufen wie bisher, ohne CORS-Header', async () => {
  const create = await send('POST', `${BASE}/bugreport`, { origin: null, contentType: 'application/json', body: jsonText({ title: 'Skript', url: 'https://example.test/s' }) });
  assert.equal(create.status, 200);
  assert.equal(create.headers.get('access-control-allow-origin'), null);
  const check = await send('GET', `${BASE}/admin/check`, { origin: null });
  assert.equal(check.status, 200);
  assert.equal(check.body.authenticated, false);
  const trade = await send('GET', `${BASE}/trade/assets/search?code=!!`, { origin: null });
  assert.equal(trade.status, 400);
});

test('PROD_ORIGIN mit Grossbuchstaben, Pfad und Slash wird normalisiert und ist erlaubt', async () => {
  const res = await send('OPTIONS', `${BASE}/bugreport`, { origin: PROD_ORIGIN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), PROD_ORIGIN);
  // Der rohe Wert ist keine Browser-Origin und passt nicht.
  assertForbidden(await send('OPTIONS', `${BASE}/bugreport`, { origin: PROD_ORIGIN_RAW }), 'raw');
});

test('https://skm.steei.de ist erlaubt', async () => {
  const res = await send('OPTIONS', `${BASE}/bugreport`, { origin: 'https://skm.steei.de' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://skm.steei.de');
});
