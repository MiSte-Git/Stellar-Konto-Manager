// Testluecke B1 (Node): Erfolgsfall des Token-Endpunkts. Ein aktiver Signer holt eine Challenge,
// signiert sie mit Zweck `token` und bekommt das accessToken des Jobs. Daneben die Gegenproben,
// damit der 200-Fall nicht zufaellig gruen ist: Signer mit Gewicht 0 bekommt 403, dieselbe
// Challenge ist nach dem Erfolg verbraucht, eine Signatur mit anderem Zweck gilt nicht.
// Horizon per test/helpers/horizonAccountsMock.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { challengeMessage } = require('../services/challengeStore.js');

const PORT = 3953;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const TOKEN = 'token-' + 'b'.repeat(40);

const owner = Keypair.random();
const zeroWeight = Keypair.random();
const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();

let server;
let dataDir;

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const challenge = async (kp) => (await post(`${BASE}/issue-job/challenge`, { signer: kp.publicKey() })).body.challenge;
const sign = (kp, nonce, purpose = 'token') => Buffer.from(kp.sign(challengeMessage(nonce, purpose))).toString('base64');
const requestToken = (kp, signature) => post(`${BASE}/issue-job/token`, { signer: kp.publicKey(), signature });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-token-issue-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [{
    id: 'issue-job', accessToken: TOKEN, network: 'testnet', accountId: owner.publicKey(),
    txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
    status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
    signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
  }] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }, { key: zeroWeight.publicKey(), weight: 0 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('aktiver Signer mit gueltiger Signatur bekommt das accessToken des Jobs (200)', async () => {
  const nonce = await challenge(owner);
  const res = await requestToken(owner, sign(owner, nonce));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { accessToken: TOKEN });

  // Das Token oeffnet den Job.
  const job = await fetch(`${BASE}/issue-job`, { headers: { 'x-job-token': res.body.accessToken } });
  assert.equal(job.status, 200);

  // Dieselbe Challenge ist danach verbraucht.
  const again = await requestToken(owner, sign(owner, nonce));
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'challenge_missing_or_expired');
});

test('Signer mit Gewicht 0 bekommt kein Token (403)', async () => {
  const nonce = await challenge(zeroWeight);
  const res = await requestToken(zeroWeight, sign(zeroWeight, nonce));
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.equal(res.body.accessToken, undefined);
});

test('Signatur mit anderem Zweck gilt nicht fuer das Token (403)', async () => {
  const nonce = await challenge(owner);
  const res = await requestToken(owner, sign(owner, nonce, 'decline'));
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
  assert.equal(res.body.accessToken, undefined);
});
