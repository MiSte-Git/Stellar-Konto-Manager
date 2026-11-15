// R-5 (Node): Das Backend sendet Job-Transaktionen ohne die SEP-29-Pruefung des SDK
// (skipMemoRequiredCheck), wie PHP. Vorher lud das SDK vor dem POST die Zielkonten; verlangte ein Ziel ein
// Memo oder scheiterte das Laden, warf es ohne HTTP-Status, und der Job wurde submit_unclear, obwohl nichts
// gesendet war. Echtes SDK gegen einen lokalen Horizon-Stub (SKM_TEST_SUBMIT_REAL_URL in
// test/helpers/horizonAccountsMock.js). Pendant: test/multisigSubmitNoMemoCheck.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3962;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const memoDest = Keypair.random().publicKey();
const brokenDest = Keypair.random().publicKey();

let server;
let stub;
let dataDir;
const requests = [];

const signedPayment = (destination) => {
  const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  tx.sign(owner);
  return tx;
};
const create = async (tx) => {
  const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: 'testnet', accountId: owner.publicKey(), txXdr: tx.toXDR() }) });
  return { status: r.status, body: await r.json() };
};
const posts = () => requests.filter((r) => r.method === 'POST').length;
const accountLoads = () => requests.filter((r) => r.method === 'GET' && r.url.startsWith('/accounts/')).length;

test.before(async () => {
  stub = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/transactions') {
      res.end(JSON.stringify({ hash: 'a'.repeat(64), ledger: 7 }));
      return;
    }
    if (req.url === `/accounts/${memoDest}`) {
      res.end(JSON.stringify({ id: memoDest, account_id: memoDest, sequence: '1', data_attr: { 'config.memo_required': 'MQ==' }, balances: [], signers: [], thresholds: {}, flags: {} }));
      return;
    }
    if (req.url === `/accounts/${brokenDest}`) {
      res.statusCode = 500;
      res.end('{"title":"oops"}');
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-nomemo-'));
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(path.join(dataDir, 'multisig_jobs.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: { signers: [{ key: owner.publicKey(), weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, sequence: '100' },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: path.join(dataDir, 'multisig_jobs.json'),
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_REAL_URL: `http://127.0.0.1:${stub.address().port}`,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  stub?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('R-5: Ziel verlangt ein Memo, Transaktion ohne Memo: wird gesendet (submitted_success), keine Abfrage des Zielkontos', async () => {
  const before = posts();
  const res = await create(signedPayment(memoDest));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_success');
  assert.equal(posts(), before + 1);
  assert.equal(accountLoads(), 0, 'das SDK laedt keine Zielkonten (skipMemoRequiredCheck)');
});

test('R-5: Laden des Zielkontos wuerde scheitern (500): trotzdem gesendet, nicht submit_unclear', async () => {
  const before = posts();
  const res = await create(signedPayment(brokenDest));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_success');
  assert.equal(posts(), before + 1);
  assert.equal(accountLoads(), 0);
});
