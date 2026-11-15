// B3-1 / R-3 (Node): Write-ahead beim Senden durch das Backend (Anlegen und Merge). Vor dem POST wird
// der Job als submit_unclear gespeichert, erst danach gesendet und das Ergebnis geschrieben.
// - Scheitert das Speichern vor dem POST, wird nicht gesendet: 500 save_failed (Anlegen) bzw.
//   merge_failed (Merge), wie bisher ohne Senden.
// - Scheitert das Speichern nach dem POST: 500 save_failed_after_submit, gespeichert bleibt
//   submit_unclear (die Klaerung uebernimmt), nie ein erneutes Senden.
// Horizon per test/helpers/horizonAccountsMock.js (Konto mit Schwelle 1, submitTransaction antwortet
// erfolgreich und zaehlt). Speicherfehler durch einen schreibgeschuetzten Datenordner, vor dem Request
// oder (arm) erst beim Senden. Pendant: test/saveFailedAfterSubmit.test.php.
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
const mergeJob = (id, tx) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
});
const signed = (tx) => {
  const t = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
  t.sign(owner);
  return t.toXDR();
};
const mergeBeforeTx = newTx(false);
const mergeAfterTx = newTx(false);

let server;
let dataDir;
let dbPath;
let submitLog;
let armFile;
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const create = (tx) => post(BASE, { network: 'testnet', accountId: owner.publicKey(), txXdr: tx.toXDR() });
const merge = (id, xdr) => post(`${BASE}/${id}/merge-signed-xdr`, { signedXdr: xdr }, { 'x-job-token': `tok-${id}` });
const readOnly = () => { try { fs.writeFileSync(path.join(dataDir, 'probe'), 'x'); fs.unlinkSync(path.join(dataDir, 'probe')); return false; } catch { return true; } };
const submits = () => (fs.existsSync(submitLog) ? fs.readFileSync(submitLog, 'utf8').split('\n').filter(Boolean).length : 0);
const storedItems = () => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items;
const writable = () => fs.chmodSync(dataDir, 0o700);

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-afters-'));
  const sideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-afters-side-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  submitLog = path.join(sideDir, 'submit.log');
  armFile = path.join(sideDir, 'arm');
  const accountsPath = path.join(sideDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [mergeJob('merge-before', mergeBeforeTx), mergeJob('merge-after', mergeAfterTx)] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath,
      SKM_TEST_SUBMIT_HASH: 'mockhash', SKM_TEST_SUBMIT_LOG: submitLog, SKM_TEST_SUBMIT_ARM_FILE: armFile, SKM_TEST_SUBMIT_ARM_DIR: dataDir,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => {
  server?.kill();
  writable();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Gegenprobe: bei beschreibbarem Ordner wird beim Anlegen gesendet und gespeichert', async () => {
  const before = submits();
  const res = await create(newTx(true));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_success');
  assert.equal(submits(), before + 1);
  assert.equal(storedItems().find((j) => j.id === res.body.id).status, 'submitted_success');
});

test('R-3 Anlegen: Speicherfehler vor dem Senden ergibt 500 save_failed, es wird nicht gesendet', async (t) => {
  fs.chmodSync(dataDir, 0o500);
  try {
    if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
    const before = submits();
    const res = await create(newTx(true));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed' });
    assert.equal(submits(), before, 'kein POST');
  } finally {
    writable();
  }
});

test('R-3 Anlegen: Speicherfehler nach dem Senden ergibt 500 save_failed_after_submit, gespeichert submit_unclear', async (t) => {
  fs.writeFileSync(armFile, '');
  try {
    const before = submits();
    const countBefore = storedItems().length;
    const res = await create(newTx(true));
    if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed_after_submit' });
    assert.equal(submits(), before + 1);
    const items = storedItems();
    assert.equal(items.length, countBefore + 1, 'Job ist vor dem Senden gespeichert');
    const job = items[0];
    assert.equal(job.status, 'submit_unclear');
    assert.ok(job.submittedAt);
    // Auch die Antwort des laufenden Prozesses zeigt den gespeicherten Stand (Speicher und Datei gleich).
    writable();
    const list = await (await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`)).json();
    assert.equal(list.find((j) => j.id === job.id).status, 'submit_unclear');
  } finally {
    fs.rmSync(armFile, { force: true });
    writable();
  }
});

test('Anlegen ohne Senden: Speicherfehler bleibt save_failed', async (t) => {
  fs.chmodSync(dataDir, 0o500);
  try {
    if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
    const before = submits();
    const res = await create(newTx(false));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed' });
    assert.equal(submits(), before);
  } finally {
    writable();
  }
});

test('R-3 Merge: Speicherfehler vor dem Senden ergibt 500 merge_failed, es wird nicht gesendet, Job unveraendert', async (t) => {
  fs.chmodSync(dataDir, 0o500);
  try {
    if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
    const before = submits();
    const res = await merge('merge-before', signed(mergeBeforeTx));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.merge_failed' });
    assert.equal(submits(), before, 'kein POST');
  } finally {
    writable();
  }
  const job = storedItems().find((j) => j.id === 'merge-before');
  assert.equal(job.status, 'pending_signatures');
  assert.equal(job.txXdrCurrent, mergeBeforeTx.toXDR());
});

test('R-3 Merge: Speicherfehler nach dem Senden ergibt 500 save_failed_after_submit, gespeichert submit_unclear, kein zweites Senden', async (t) => {
  fs.writeFileSync(armFile, '');
  let res;
  const before = submits();
  try {
    res = await merge('merge-after', signed(mergeAfterTx));
    if (!readOnly()) return t.skip('Speicherfehler nicht simulierbar (z. B. root)');
  } finally {
    fs.rmSync(armFile, { force: true });
    writable();
  }
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'multisig.jobs.save_failed_after_submit' });
  assert.equal(submits(), before + 1);
  const job = storedItems().find((j) => j.id === 'merge-after');
  assert.equal(job.status, 'submit_unclear');
  assert.equal(job.txXdrCurrent, signed(mergeAfterTx), 'die Signatur ist mit dem Write-ahead gespeichert');
  // Erneuter Merge: 409 submit_unclear, kein weiterer POST.
  const again = await merge('merge-after', signed(mergeAfterTx));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'submit_unclear');
  assert.equal(submits(), before + 1);
});
