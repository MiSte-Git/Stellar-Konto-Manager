// G1/G2: composeMail im Node-Backend. Fehlt das Mailprogramm, antwortet der Server mit
// 500 composeMail.spawnFailed und laeuft weiter (vorher beendete das unbehandelte
// error-Event den Prozess). Aufrufe mit fremder Adresse im X-Forwarded-For (Vite-Proxy)
// werden mit 403 abgewiesen. composeMail gibt es nur in Node (README, SECURITY.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3931;
const BASE = `http://127.0.0.1:${PORT}/api`;
let server;
let exited = false;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-compose-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      BUG_DB_DIR: dataDir,
      BUG_DB_PATH: path.join(dataDir, 'b.json'),
      MULTISIG_DB_PATH: path.join(dataDir, 'm.json'),
      ENABLE_COMPOSE_MAIL: '1',
      COMPOSE_MAIL_BIN: path.join(dataDir, 'gibt-es-nicht'),
    },
    stdio: 'ignore',
  });
  server.on('exit', () => { exited = true; });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}/admin/check`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (headers = {}) => fetch(`${BASE}/composeMail`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ to: 'a@example.test', subject: 's', body: 'b' }),
});

test('G1: fehlendes Mailprogramm ergibt 500 composeMail.spawnFailed, der Prozess laeuft weiter', async () => {
  const res = await post();
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, error: 'composeMail.spawnFailed' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(exited, false, 'Server darf nicht abstuerzen');
  // Gegenprobe: er antwortet weiterhin.
  const again = await post();
  assert.equal(again.status, 500);
  assert.equal((await fetch(`${BASE}/admin/check`)).status, 200);
});

test('G2: Aufruf mit fremder Adresse im X-Forwarded-For wird abgewiesen, Loopback-Adresse nicht', async () => {
  for (const headers of [
    { 'x-forwarded-for': '203.0.113.7' },
    { 'x-forwarded-for': '127.0.0.1, 203.0.113.7' },
    { forwarded: 'for=198.51.100.2' },
    { 'x-real-ip': '198.51.100.2' },
  ]) {
    const res = await post(headers);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { ok: false, error: 'composeMail.forbidden' });
  }
  // Loopback im Header: erreicht den Handler (hier 500, weil das Programm fehlt).
  assert.equal((await post({ 'x-forwarded-for': '127.0.0.1' })).status, 500);
});
