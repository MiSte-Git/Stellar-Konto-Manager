// Speicherfehler (Node): Schlaegt das Schreiben der Jobdatei fehl, meldet kein Weg Erfolg.
// Anlegen, Merge, Ablehnen und Loeschen antworten 500 (save_failed / merge_failed /
// decline_failed / delete_failed) und lassen keinen halben Stand im Speicher. Der Fehler wird erzeugt, indem der
// Datenordner nach dem Start schreibgeschuetzt wird. Pendant: test/multisigStorageFail.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3932;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const b = Keypair.random();

const newTx = () => new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
const mergeTx = newTx();
const signedByOwner = (() => { const t = TransactionBuilder.fromXDR(mergeTx.toXDR(), Networks.TESTNET); t.sign(owner); return t; })();
const mergeJob = {
  id: 'merge-job', accessToken: 'tok-merge', network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(mergeTx.hash()).toString('hex'), txXdrOriginal: mergeTx.toXDR(), txXdrCurrent: mergeTx.toXDR(),
  status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }, { publicKey: b.publicKey(), weight: 1 }],
  requiredWeight: 2, collectedSigners: [], collectedWeight: 0,
};

const finalJob = { ...mergeJob, id: 'final-job', accessToken: 'tok-final', status: 'expired' };

let server;
let dataDir;
let dbPath;

const ids = () => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.map((j) => j.id);
const postJson = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
// Challenge holen und mit Zweck (decline, delete) signieren; Antwort der Aktion zurueckgeben.
const act = async (jobId, action, kp) => {
  const { body: ch } = await postJson(`${BASE}/${jobId}/challenge`, { signer: kp.publicKey() });
  const nonce = Buffer.from(ch.challenge, 'base64');
  const signature = Buffer.from(kp.sign(Buffer.concat([Buffer.from(`skm:${action}:`), nonce]))).toString('base64');
  return postJson(`${BASE}/${jobId}/${action}`, { signer: kp.publicKey(), signature });
};
const list = async () => (await (await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`)).json());

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-storefail-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [mergeJob, finalJob] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }, { key: b.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await list(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  // Anlegen und Merge brauchen den Lock im selben Ordner: schreibgeschuetzt = Speichern schlaegt fehl.
  fs.chmodSync(dataDir, 0o500);
});

test.after(() => {
  server?.kill();
  fs.chmodSync(dataDir, 0o700);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Sanity: der Datenordner ist wirklich schreibgeschuetzt', (t) => {
  try {
    fs.writeFileSync(path.join(dataDir, 'probe'), 'x');
    t.skip('Prozess darf trotz 0500 schreiben (z. B. root): Speicherfehler nicht simulierbar');
  } catch (e) {
    assert.match(String(e.code), /EACCES|EPERM|EROFS/);
  }
});

test('Anlegen: Speicherfehler ergibt 500 save_failed und der Job steht nicht in der Liste', async (t) => {
  try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); return t.skip('Speicherfehler nicht simulierbar'); } catch {}
  const res = await postJson(BASE, { network: 'testnet', accountId: owner.publicKey(), txXdr: newTx().toXDR() });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed' });
  const jobs = await list();
  assert.deepEqual((jobs.items || jobs).map((j) => j.id).sort(), ['final-job', 'merge-job']);
  assert.deepEqual(ids(), ['merge-job', 'final-job']);
});

test('Merge: Speicherfehler ergibt 500 merge_failed und der Job bleibt unveraendert', async (t) => {
  try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); return t.skip('Speicherfehler nicht simulierbar'); } catch {}
  const res = await postJson(`${BASE}/merge-job/merge-signed-xdr`, { signedXdr: signedByOwner.toXDR() }, { 'x-job-token': 'tok-merge' });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.merge_failed' });
  const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items[0];
  assert.equal(stored.collectedWeight, 0);
  // Auch im Speicher des Servers ist die Signatur nicht uebernommen.
  const jobs = await list();
  const job = (jobs.items || jobs).find((j) => j.id === 'merge-job');
  assert.equal(job.collectedWeight, 0);
});

test('Ablehnen: Speicherfehler ergibt 500 decline_failed und der Job bleibt unveraendert', async (t) => {
  try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); return t.skip('Speicherfehler nicht simulierbar'); } catch {}
  const res = await act('merge-job', 'decline', b);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.decline_failed' });
  const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === 'merge-job');
  assert.notEqual(stored.status, 'rejected');
  assert.ok(!(stored.declinedSigners || []).length);
  // Auch im Speicher des Servers ist die Ablehnung zurueckgenommen.
  const jobs = await list();
  const job = (jobs.items || jobs).find((j) => j.id === 'merge-job');
  assert.notEqual(job.status, 'rejected');
  assert.ok(!(job.declinedSigners || []).length);
});

test('Loeschen: Speicherfehler ergibt 500 delete_failed und der Job bleibt erhalten', async (t) => {
  try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); return t.skip('Speicherfehler nicht simulierbar'); } catch {}
  const res = await act('final-job', 'delete', b);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.delete_failed' });
  assert.ok(ids().includes('final-job'));
  // Auch im Speicher des Servers steht der Job noch.
  const jobs = await list();
  assert.ok((jobs.items || jobs).some((j) => j.id === 'final-job'));
});

test('Merge nach behobenem Speicherfehler: Erfolg und Signatur gespeichert', async () => {
  fs.chmodSync(dataDir, 0o700);
  const res = await postJson(`${BASE}/merge-job/merge-signed-xdr`, { signedXdr: signedByOwner.toXDR() }, { 'x-job-token': 'tok-merge' });
  assert.equal(res.status, 200);
  assert.equal(res.body.collectedWeight, 1);
  assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).items[0].collectedWeight, 1);
});
