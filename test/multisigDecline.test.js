// Feature 31.10.: Ablehnen und Loeschen einzelner Multisig-Jobs (Node).
// Pendant: test/multisigDecline.test.php (dort auch der volle Ablauf mit vorbelegtem
// Signer-Cache; Node fragt die Signer live ab, das geht offline nicht).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { applyDecline, dropDeclinesOfCollected } = require('../services/multisigDecline.js');

const signers = (...w) => w.map((weight, i) => ({ publicKey: `S${i}`, weight }));

test('applyDecline: bleibt offen, solange die uebrigen Signer das Gewicht erreichen', () => {
  const r = applyDecline({ requiredWeight: 2, status: 'pending_signatures' }, 'S1', signers(1, 1, 1), 'now');
  assert.equal(r.status, 'pending_signatures');
  assert.equal(r.possibleWeight, 2);
  assert.deepEqual(r.declinedSigners, [{ publicKey: 'S1', at: 'now' }]);
});

test('applyDecline: abgelehnt, wenn das Gewicht nicht mehr reicht; doppelte Ablehnung zaehlt einmal', () => {
  const first = applyDecline({ requiredWeight: 2, status: 'pending_signatures' }, 'S1', signers(1, 1, 1), 't1');
  const second = applyDecline({ requiredWeight: 2, status: first.status, declinedSigners: first.declinedSigners }, 'S2', signers(1, 1, 1), 't2');
  assert.equal(second.status, 'rejected');
  const again = applyDecline({ requiredWeight: 2, status: 'pending_signatures', declinedSigners: first.declinedSigners }, 'S1', signers(1, 1, 1), 't3');
  assert.equal(again.declinedSigners.length, 1);
  assert.equal(again.declinedSigners[0].at, 't3');
});

test('applyDecline: ohne bekanntes requiredWeight nie abgelehnt, Signer mit Gewicht 0 zaehlen nicht', () => {
  assert.equal(applyDecline({ requiredWeight: 0, status: 'pending_signatures' }, 'S0', signers(1), 'x').status, 'pending_signatures');
  assert.equal(applyDecline({ requiredWeight: 1, status: 'pending_signatures' }, 'S0', signers(1, 0), 'x').status, 'rejected');
});

test('dropDeclinesOfCollected: wer signiert hat, lehnt nicht mehr ab', () => {
  assert.deepEqual(dropDeclinesOfCollected([{ publicKey: 'A' }, { publicKey: 'B' }], [{ publicKey: 'B' }]), [{ publicKey: 'A' }]);
});

const PORT = 3921;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
const baseJob = (id, status, token) => ({
  id,
  accessToken: token,
  network: 'testnet',
  accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'),
  txXdrOriginal: tx.toXDR(),
  txXdrCurrent: tx.toXDR(),
  status,
  createdAt: new Date().toISOString(),
  maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }],
  requiredWeight: 1,
  collectedSigners: [],
  collectedWeight: 0,
});

let server;
let dataDir;
let dbPath;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-decline-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [baseJob('offen', 'pending_signatures', 'tok-offen'), baseJob('alt', 'expired', 'tok-alt')] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath },
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
const del = async (url, token) => {
  const r = await fetch(url, { method: 'DELETE', headers: token ? { 'x-job-token': token } : {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signChallenge = (kp, challenge, purpose = 'decline') => {
  const nonce = Buffer.from(challenge, 'base64');
  const data = purpose ? Buffer.concat([Buffer.from(`skm:${purpose}:`), nonce]) : nonce;
  return Buffer.from(kp.sign(data)).toString('base64');
};

test('Ablehnen ohne Challenge -> 400, mit falscher Signatur -> 403', async () => {
  const signer = Keypair.random();
  let res = await post(`${BASE}/offen/decline`, { signer: signer.publicKey(), signature: 'AAAA' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  const { body: ch } = await post(`${BASE}/offen/challenge`, { signer: signer.publicKey() });
  res = await post(`${BASE}/offen/decline`, { signer: signer.publicKey(), signature: signChallenge(Keypair.random(), ch.challenge) });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
});

test('Ablehnen: Signatur gueltig, aber kein Signer des Kontos -> 403, Job unveraendert', async () => {
  const stranger = Keypair.random();
  const { body: ch } = await post(`${BASE}/offen/challenge`, { signer: stranger.publicKey() });
  const res = await post(`${BASE}/offen/decline`, { signer: stranger.publicKey(), signature: signChallenge(stranger, ch.challenge) });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === 'offen');
  assert.equal(stored.declinedSigners, undefined);
});

test('Ablehnen: eine Token-Signatur (ohne Zweck) gilt nicht als Ablehnung', async () => {
  const signer = Keypair.random();
  const { body: ch } = await post(`${BASE}/offen/challenge`, { signer: signer.publicKey() });
  const res = await post(`${BASE}/offen/decline`, { signer: signer.publicKey(), signature: signChallenge(signer, ch.challenge, '') });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
});

test('Ablehnen: Challenge ist einmalig und an den Job gebunden', async () => {
  const signer = Keypair.random();
  const { body: ch } = await post(`${BASE}/offen/challenge`, { signer: signer.publicKey() });
  const sig = signChallenge(signer, ch.challenge);
  await post(`${BASE}/offen/decline`, { signer: signer.publicKey(), signature: sig });
  const again = await post(`${BASE}/offen/decline`, { signer: signer.publicKey(), signature: sig });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'challenge_missing_or_expired');
  const { body: other } = await post(`${BASE}/offen/challenge`, { signer: signer.publicKey() });
  const elsewhere = await post(`${BASE}/alt/decline`, { signer: signer.publicKey(), signature: signChallenge(signer, other.challenge) });
  assert.equal(elsewhere.status, 400);
});

test('Ablehnen: Eingaben ohne String -> 400', async () => {
  const res = await post(`${BASE}/offen/decline`, { signer: 42, signature: ['x'] });
  assert.equal(res.status, 400);
});

test('Loeschen: ohne Token 403, offener Job 409 not_final, Endzustand mit Token geloescht', async () => {
  assert.equal((await del(`${BASE}/alt`)).status, 403);
  const open = await del(`${BASE}/offen`, 'tok-offen');
  assert.equal(open.status, 409);
  assert.equal(open.body.error, 'not_final');
  const done = await del(`${BASE}/alt`, 'tok-alt');
  assert.equal(done.status, 200);
  const r = await fetch(`${BASE}/alt`, { headers: { 'x-job-token': 'tok-alt' } });
  assert.equal(r.status, 404);
  assert.equal((await del(`${BASE}/alt`, 'tok-alt')).status, 404);
});
