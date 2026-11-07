// G5: Kaputtes JSON ergibt 400 invalid_json ohne Stacktrace und ohne Inhalt des Bodys
// (vorher Express-Standardfehler mit Stacktrace und Body-Ausschnitt). Gilt fuer alle Routen,
// die JSON lesen. Pendant: test/invalidJson.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3934;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ORIGIN = 'http://localhost:5173';
const SECRET_MARKER = 'GEHEIMER-BODY-INHALT';

let server;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-json-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      BUG_DB_DIR: dataDir,
      BUG_DB_PATH: path.join(dataDir, 'b.json'),
      MULTISIG_DB_PATH: path.join(dataDir, 'm.json'),
      BUGTRACKER_ADMIN_SECRET: 'json-test-secret',
      ENABLE_COMPOSE_MAIL: '0',
      NODE_ENV: 'development',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}/admin/check`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body });
  const text = await res.text();
  return { status: res.status, text };
};

test('G5: kaputtes JSON ergibt 400 invalid_json, ohne Stacktrace und ohne Body-Inhalt', async () => {
  for (const url of [`${BASE}/multisig/jobs`, `${BASE}/bugreport`, `${BASE}/admin/login`]) {
    for (const body of [`{"x": "${SECRET_MARKER}"`, `{"x": ${SECRET_MARKER}}`, 'nur text']) {
      const res = await post(url, body);
      assert.equal(res.status, 400, `${url} ${body}`);
      assert.deepEqual(JSON.parse(res.text), { ok: false, error: 'invalid_json' }, url);
      assert.equal(res.text.includes(SECRET_MARKER), false, 'Body-Inhalt darf nicht zurueckkommen');
      assert.equal(/\bat .*\.js|SyntaxError|node_modules|<pre>/.test(res.text), false, 'kein Stacktrace');
    }
  }
});

test('G5: leerer Body und gueltiges JSON laufen weiter wie bisher', async () => {
  const empty = await post(`${BASE}/multisig/jobs`, '');
  assert.equal(empty.status, 400);
  assert.equal(JSON.parse(empty.text).error, 'invalid_network');
  const ok = await post(`${BASE}/multisig/jobs`, '{}');
  assert.equal(JSON.parse(ok.text).error, 'invalid_network');
});
