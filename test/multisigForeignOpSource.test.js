// ADR 0013 (Node): Ein Job mit fremder op.source wird nie automatisch gesendet. Das Backend prueft nur
// Gewicht und Signer des Job-Kontos; gesendet haette das Netz mit tx_bad_auth abgelehnt (submitted_failed).
// Anlegen (Single-Sig) und Merge (Gewicht erreicht) speichern ready_to_submit mit foreignOpSources und
// senden nicht; ohne fremde Quelle wird wie bisher gesendet. Liste und Detail liefern das Feld.
// Echtes SDK gegen einen lokalen Horizon-Stub, Kontodaten ueber test/helpers/horizonAccountsMock.js.
// Pendant: test/multisigForeignOpSource.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, MuxedAccount, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3965;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random(); // Single-Sig
const vault = Keypair.random(); // 2 von 2
const s1 = Keypair.random();
const s2 = Keypair.random();
const foreign = Keypair.random().publicKey();

let server;
let stub;
let dataDir;
let seq = 100;
const requests = [];

const payment = (sourceAccount, { opSource, signers }) => {
  seq += 1;
  const opts = { destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' };
  if (opSource) opts.source = opSource;
  const tx = new TransactionBuilder(new Account(sourceAccount, String(seq)), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment(opts))
    .setTimeout(3600)
    .build();
  signers.forEach((kp) => tx.sign(kp));
  return tx;
};
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const create = (accountId, tx) => post(BASE, { network: 'testnet', accountId, txXdr: tx.toXDR() });
const posts = () => requests.filter((r) => r.method === 'POST' && r.url === '/transactions').length;

test.before(async () => {
  stub = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/transactions') {
      res.end(JSON.stringify({ hash: 'b'.repeat(64), ledger: 7 }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-foreign-src-'));
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(path.join(dataDir, 'multisig_jobs.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: { signers: [{ key: owner.publicKey(), weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, sequence: '100' },
    [vault.publicKey()]: {
      signers: [{ key: vault.publicKey(), weight: 0 }, { key: s1.publicKey(), weight: 1 }, { key: s2.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
      sequence: '100',
    },
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

test('Anlegen, Gewicht erreicht, fremde op.source: kein Senden, ready_to_submit mit foreignOpSources', async () => {
  const before = posts();
  const res = await create(owner.publicKey(), payment(owner.publicKey(), { opSource: foreign, signers: [owner] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready_to_submit');
  assert.deepEqual(res.body.foreignOpSources, [foreign]);
  assert.equal(posts(), before, 'nichts an Horizon gesendet');

  const detail = await fetch(`${BASE}/${res.body.id}`, { headers: { 'x-job-token': res.body.accessToken } }).then((r) => r.json());
  assert.equal(detail.status, 'ready_to_submit');
  assert.deepEqual(detail.foreignOpSources, [foreign]);
  const list = await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`).then((r) => r.json());
  assert.deepEqual(list.find((j) => j.id === res.body.id)?.foreignOpSources, [foreign], 'Liste liefert das Feld ohne XDR');
});

test('Anlegen, M-Adresse des Job-Kontos als op.source: nicht fremd, wird gesendet', async () => {
  const before = posts();
  const m = new MuxedAccount(new Account(owner.publicKey(), '0'), '9').accountId();
  const res = await create(owner.publicKey(), payment(owner.publicKey(), { opSource: m, signers: [owner] }));
  assert.equal(res.body.status, 'submitted_success');
  assert.deepEqual(res.body.foreignOpSources, []);
  assert.equal(posts(), before + 1);
});

test('Anlegen ohne fremde op.source: wird wie bisher gesendet', async () => {
  const before = posts();
  const res = await create(owner.publicKey(), payment(owner.publicKey(), { signers: [owner] }));
  assert.equal(res.body.status, 'submitted_success');
  assert.equal(posts(), before + 1);
});

test('FS-7.1: accountId mit Leerzeichen und eigener op.source: getrimmt, nicht fremd, wird gesendet', async () => {
  const before = posts();
  const res = await create(` ${owner.publicKey()} `, payment(owner.publicKey(), { opSource: owner.publicKey(), signers: [owner] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.accountId, owner.publicKey());
  assert.equal(res.body.status, 'submitted_success');
  assert.deepEqual(res.body.foreignOpSources, []);
  assert.equal(posts(), before + 1);
});

test('FS-7.1: accountId mit Leerzeichen und fremder op.source: nicht gesendet', async () => {
  const before = posts();
  const res = await create(` ${owner.publicKey()} `, payment(owner.publicKey(), { opSource: foreign, signers: [owner] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready_to_submit');
  assert.deepEqual(res.body.foreignOpSources, [foreign], 'nur das fremde Konto, nicht das Job-Konto');
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('FS-7.2: fremde M-Adresse als op.source: nicht gesendet, foreignOpSources mit dem G-Konto', async () => {
  const before = posts();
  const foreignM = new MuxedAccount(new Account(foreign, '0'), '7').accountId();
  const res = await create(owner.publicKey(), payment(owner.publicKey(), { opSource: foreignM, signers: [owner] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready_to_submit');
  assert.deepEqual(res.body.foreignOpSources, [foreign]);
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('Merge erreicht das Gewicht, fremde op.source: kein Senden, ready_to_submit', async () => {
  const tx = payment(vault.publicKey(), { opSource: foreign, signers: [s1] });
  const created = await create(vault.publicKey(), tx);
  assert.equal(created.body.status, 'pending_signatures');
  assert.deepEqual(created.body.foreignOpSources, [foreign]);
  const before = posts();
  tx.sign(s2);
  const merged = await post(`${BASE}/${created.body.id}/merge-signed-xdr`, { signedXdr: tx.toXDR() }, { 'x-job-token': created.body.accessToken });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.status, 'ready_to_submit');
  assert.deepEqual(merged.body.foreignOpSources, [foreign]);
  assert.equal(merged.body.collectedWeight, 2);
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
  const again = await post(`${BASE}/${created.body.id}/merge-signed-xdr`, { signedXdr: tx.toXDR() }, { 'x-job-token': created.body.accessToken });
  assert.equal(again.body.status, 'ready_to_submit', 'erneuter Merge ohne neue Signatur bleibt bereit und sendet nicht');
  assert.equal(posts(), before);
});

test('Merge erreicht das Gewicht ohne fremde op.source: wird wie bisher gesendet', async () => {
  const tx = payment(vault.publicKey(), { signers: [s1] });
  const created = await create(vault.publicKey(), tx);
  const before = posts();
  tx.sign(s2);
  const merged = await post(`${BASE}/${created.body.id}/merge-signed-xdr`, { signedXdr: tx.toXDR() }, { 'x-job-token': created.body.accessToken });
  assert.equal(merged.body.status, 'submitted_success');
  assert.equal(posts(), before + 1);
});
