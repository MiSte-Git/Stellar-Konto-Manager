// #8: Das Job-Token gilt nur im Header x-job-token, nie als ?token= in der URL.
// Echter HTTP-Test gegen server.js (Pendant: test/multisigJobToken.test.php).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3919;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const TOKEN = 'token-' + 'a'.repeat(40);

const owner = Keypair.random();
const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();

const job = {
  id: 'token-job',
  accessToken: TOKEN,
  network: 'testnet',
  accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'),
  txXdrOriginal: tx.toXDR(),
  txXdrCurrent: tx.toXDR(),
  status: 'pending_signatures',
  createdAt: new Date().toISOString(),
  maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }],
  requiredWeight: 1,
  collectedSigners: [],
  collectedWeight: 0,
};

let server;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-token-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [job] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${BASE}?network=testnet`);
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

const get = (url, headers = {}) => fetch(url, { headers });
const merge = (url, headers = {}) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ signedXdr: tx.toXDR() }),
});

test('Job-Abruf mit Token im Header geht', async () => {
  const res = await get(`${BASE}/token-job`, { 'x-job-token': TOKEN });
  assert.equal(res.status, 200);
});

test('Job-Abruf mit ?token= statt Header wird abgelehnt', async () => {
  const res = await get(`${BASE}/token-job?token=${TOKEN}`);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'forbidden');
});

test('Job-Abruf ohne Token wird abgelehnt', async () => {
  assert.equal((await get(`${BASE}/token-job`)).status, 403);
});

test('Merge mit ?token= statt Header wird abgelehnt', async () => {
  const res = await merge(`${BASE}/token-job/merge-signed-xdr?token=${TOKEN}`);
  assert.equal(res.status, 403);
});

test('Header zaehlt, ein falsches ?token= daneben wird ignoriert', async () => {
  const res = await get(`${BASE}/token-job?token=falsch`, { 'x-job-token': TOKEN });
  assert.equal(res.status, 200);
});
