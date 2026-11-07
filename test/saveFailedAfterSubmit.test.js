// B3-1 (Node): Schlaegt das Speichern fehl, nachdem schon an Horizon gesendet wurde, meldet das
// Backend 500 multisig.jobs.save_failed_after_submit statt save_failed / merge_failed: Die
// Transaktion kann im Netz sein, ein erneutes Senden waere falsch. Ohne Senden bleiben die
// bisherigen Codes. Horizon wird per test/helpers/horizonAccountsMock.js ersetzt (Konto mit
// Schwelle 1, submitTransaction antwortet erfolgreich). Der Speicherfehler entsteht durch einen
// schreibgeschuetzten Datenordner. Pendant: test/saveFailedAfterSubmit.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3940;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();

const newTx = (sign) => {
  const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  if (sign) tx.sign(owner);
  return tx;
};
const mergeTx = newTx(false);
const mergeSigned = TransactionBuilder.fromXDR(mergeTx.toXDR(), Networks.TESTNET);
mergeSigned.sign(owner);
const mergeJob = {
  id: 'merge-job', accessToken: 'tok-merge', network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(mergeTx.hash()).toString('hex'), txXdrOriginal: mergeTx.toXDR(), txXdrCurrent: mergeTx.toXDR(),
  status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
};

let server;
let dataDir;
let dbPath;
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const create = (tx) => post(BASE, { network: 'testnet', accountId: owner.publicKey(), txXdr: tx.toXDR() });
const readOnly = () => { try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); return false; } catch { return true; } };

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-afters-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [mergeJob] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_HASH: 'mockhash' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => {
  server?.kill();
  fs.chmodSync(dataDir, 0o700);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Gegenprobe: bei beschreibbarem Ordner wird beim Anlegen gesendet und gespeichert', async () => {
  const res = await create(newTx(true));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_success');
});

test('Anlegen mit Senden: Speicherfehler ergibt 500 save_failed_after_submit', async (t) => {
  fs.chmodSync(dataDir, 0o500);
  if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
  const res = await create(newTx(true));
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed_after_submit' });
});

test('Anlegen ohne Senden: Speicherfehler bleibt save_failed', async (t) => {
  if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
  const res = await create(newTx(false));
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed' });
});

test('Merge mit Senden: Speicherfehler ergibt 500 save_failed_after_submit', async (t) => {
  if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
  const res = await post(`${BASE}/merge-job/merge-signed-xdr`, { signedXdr: mergeSigned.toXDR() }, { 'x-job-token': 'tok-merge' });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed_after_submit' });
});
