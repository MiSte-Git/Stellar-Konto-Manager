// C1: Loeschen einzelner Multisig-Jobs nur fuer aktuelle Signer per signierter Challenge mit
// Zweck delete (Node). Das Job-Token reicht nicht mehr. Die Live-Pruefung der Signer laeuft
// gegen einen Horizon-Mock (test/helpers/horizonAccountsMock.js), der per --require vor
// server.js geladen wird. Pendant: test/multisigDelete.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3923;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const b = Keypair.random();
const c = Keypair.random();
const zero = Keypair.random();
const stranger = Keypair.random();
const unknownAccount = Keypair.random();

const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
const baseJob = (id, status, token, accountId = owner.publicKey()) => ({
  id,
  accessToken: token,
  network: 'testnet',
  accountId,
  txHash: Buffer.from(tx.hash()).toString('hex'),
  txXdrOriginal: tx.toXDR(),
  txXdrCurrent: tx.toXDR(),
  status,
  createdAt: new Date().toISOString(),
  maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }, { publicKey: b.publicKey(), weight: 1 }, { publicKey: c.publicKey(), weight: 1 }],
  requiredWeight: 2,
  collectedSigners: [],
  collectedWeight: 0,
});

const liveAccount = (signers) => ({
  [owner.publicKey()]: {
    signers: signers.map(([kp, weight]) => ({ key: kp.publicKey(), weight })),
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
    sequence: '100',
  },
});

let server;
let dataDir;
let dbPath;
let accountsPath;

const storedIds = () => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.map((j) => j.id);

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-delete-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [
    baseJob('offen', 'pending_signatures', 'tok-offen'),
    baseJob('abgelaufen', 'expired', 'tok-abgelaufen'),
    baseJob('abgelehnt', 'rejected', 'tok-abgelehnt'),
    baseJob('gesendet', 'submitted_success', 'tok-gesendet'),
    baseJob('fremd', 'expired', 'tok-fremd', unknownAccount.publicKey()),
  ] }));
  fs.writeFileSync(accountsPath, JSON.stringify(liveAccount([[owner, 1], [b, 1], [c, 1], [zero, 0]])));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`);
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

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signChallenge = (kp, challenge, purpose) => {
  const nonce = Buffer.from(challenge, 'base64');
  const data = purpose === null ? nonce : Buffer.concat([Buffer.from(`skm:${purpose}:`), nonce]);
  return Buffer.from(kp.sign(data)).toString('base64');
};
// Budget: /challenge erlaubt 20 Anfragen je Minute und IP (C2), diese Datei braucht 17.
// Neue Faelle nur mit Blick darauf ergaenzen. Challenge fuer signer holen, mit signWith (Standard: signer) und Zweck signieren, an action schicken.
const withChallenge = async (jobId, signer, action, purpose, signWith = signer) => {
  const { body: ch } = await post(`${BASE}/${jobId}/challenge`, { signer: signer.publicKey() });
  return post(`${BASE}/${jobId}/${action}`, { signer: signer.publicKey(), signature: signChallenge(signWith, ch.challenge, purpose) });
};

test('Mock-Sanity: token-Signatur eines aktiven Signers bekommt das Token (Live-Pruefung greift)', async () => {
  const res = await withChallenge('abgelaufen', b, 'token', 'token');
  assert.equal(res.status, 200);
  assert.equal(res.body.accessToken, 'tok-abgelaufen');
});

test('Alter Endpunkt DELETE /jobs/:id existiert nicht mehr, gueltiges Token loescht nichts', async () => {
  const r = await fetch(`${BASE}/abgelaufen`, { method: 'DELETE', headers: { 'x-job-token': 'tok-abgelaufen' } });
  assert.equal(r.status, 404);
  assert.ok(storedIds().includes('abgelaufen'));
  // Auch am neuen Endpunkt ersetzt das Token keine Signatur.
  const viaHeader = await fetch(`${BASE}/abgelaufen/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-job-token': 'tok-abgelaufen' },
    body: JSON.stringify({}),
  });
  assert.equal(viaHeader.status, 400);
  assert.ok(storedIds().includes('abgelaufen'));
});

test('Loeschen: unbekannter Job 404, Eingaben 400', async () => {
  assert.equal((await post(`${BASE}/gibtsnicht/delete`, { signer: b.publicKey(), signature: 'AAAA' })).status, 404);
  let res = await post(`${BASE}/abgelaufen/delete`, { signer: 'kein-key', signature: 'AAAA' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_signer');
  res = await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: '' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'missing_signature');
  res = await post(`${BASE}/abgelaufen/delete`, { signer: 42, signature: ['x'] });
  assert.equal(res.status, 400);
});

test('Loeschen ohne Challenge -> 400 challenge_missing_or_expired, Challenge ist einmalig und an den Job gebunden', async () => {
  let res = await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: 'AAAA' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  // Challenge eines anderen Jobs gilt nicht.
  const { body: other } = await post(`${BASE}/offen/challenge`, { signer: b.publicKey() });
  res = await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: signChallenge(b, other.challenge, 'delete') });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  // Verbraucht wird sie auch bei falscher Signatur: Nachreichen der richtigen scheitert.
  const { body: ch } = await post(`${BASE}/abgelaufen/challenge`, { signer: b.publicKey() });
  await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: signChallenge(b, ch.challenge, 'token') });
  res = await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: signChallenge(b, ch.challenge, 'delete') });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  assert.ok(storedIds().includes('abgelaufen'));
});

test('Loeschen: Signatur mit Zweck token, decline, roh oder fremdem Key -> 403 invalid_signature', async () => {
  for (const purpose of ['token', 'decline', null]) {
    const res = await withChallenge('abgelaufen', b, 'delete', purpose);
    assert.equal(res.status, 403, `purpose ${purpose}`);
    assert.equal(res.body.error, 'invalid_signature');
  }
  const res = await withChallenge('abgelaufen', b, 'delete', 'delete', Keypair.random());
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
  assert.ok(storedIds().includes('abgelaufen'));
});

test('delete-Signatur gilt nicht fuer Token und Ablehnen', async () => {
  let res = await withChallenge('abgelaufen', b, 'token', 'delete');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
  res = await withChallenge('offen', b, 'decline', 'delete');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
});

test('Loeschen: Nicht-Signer, Signer mit Gewicht 0 und Konto ohne Horizon-Antwort -> 403 forbidden', async () => {
  for (const kp of [stranger, zero]) {
    const res = await withChallenge('abgelaufen', kp, 'delete', 'delete');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  }
  // Konto, das der Horizon-Mock nicht kennt: loadAccount wirft -> 403.
  const res = await withChallenge('fremd', b, 'delete', 'delete');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.ok(storedIds().includes('abgelaufen'));
  assert.ok(storedIds().includes('fremd'));
});

test('Loeschen eines offenen Jobs -> 409 not_final mit status', async () => {
  const res = await withChallenge('offen', b, 'delete', 'delete');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_final');
  assert.equal(res.body.status, 'pending_signatures');
  assert.ok(storedIds().includes('offen'));
});

test('Gueltige delete-Signatur eines aktiven Signers loescht einen Job im Endzustand', async () => {
  const res = await withChallenge('abgelaufen', b, 'delete', 'delete');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(!storedIds().includes('abgelaufen'));
  assert.equal((await post(`${BASE}/abgelaufen/challenge`, { signer: b.publicKey() })).status, 404);
  assert.equal((await post(`${BASE}/abgelaufen/delete`, { signer: b.publicKey(), signature: 'AAAA' })).status, 404);
});

test('Entfernter Signer: Gewicht 0 oder nicht mehr in der Liste -> 403, obwohl er frueher Signer war', async () => {
  // b hat im ersten Test noch gueltig ein Token bekommen, war also Signer.
  fs.writeFileSync(accountsPath, JSON.stringify(liveAccount([[owner, 1], [b, 0]])));
  for (const kp of [b, c]) {
    const res = await withChallenge('abgelehnt', kp, 'delete', 'delete');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  }
  assert.ok(storedIds().includes('abgelehnt'));
  // Der verbliebene Signer darf weiter loeschen.
  const res = await withChallenge('abgelehnt', owner, 'delete', 'delete');
  assert.equal(res.status, 200);
  assert.ok(!storedIds().includes('abgelehnt'));
});
