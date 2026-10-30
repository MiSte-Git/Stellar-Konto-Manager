// K1: Die Quelle eines Multisig-Jobs muss der Transaktion entsprechen.
// Laeuft als echter HTTP-Test gegen server.js in einem eigenen Prozess mit
// eigenem Datenordner (Pendant: test/multisigAccountMismatch.test.php).
// Alle Konten sind zufaellig und existieren nicht: Die Konto-Abfrage schlaegt online
// wie offline fehl. Die Pruefungen brauchen Horizon nicht, und das Anlegen geht weiter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, MuxedAccount, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { txSourceBaseAccount } = require('../services/txSignatures.js');

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const NOT_SIGNED_BY_ANYONE = Keypair.random();

function paymentTx(sourceAccount) {
  return new TransactionBuilder(sourceAccount, { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: NOT_SIGNED_BY_ANYONE.publicKey(), asset: Asset.native(), amount: '9000' }))
    .setTimeout(3600)
    .build();
}

const attackerAccount = Keypair.random().publicKey();
const victim = Keypair.random();
const victimTx = paymentTx(new Account(victim.publicKey(), '100'));

// Altjob von vor dem Fix: gespeichertes accountId weicht von der Tx-Quelle ab.
const legacyJob = {
  id: 'legacy-mismatch',
  accessToken: 'legacy-token',
  network: 'testnet',
  accountId: attackerAccount,
  txHash: Buffer.from(victimTx.hash()).toString('hex'),
  txXdrOriginal: victimTx.toXDR(),
  txXdrCurrent: victimTx.toXDR(),
  status: 'pending_signatures',
  createdAt: new Date().toISOString(),
  maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: victim.publicKey(), weight: 1 }],
  requiredWeight: 1,
  collectedSigners: [],
  collectedWeight: 0,
};

let server;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-k1-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [legacyJob] }));
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${BASE}?accountId=${attackerAccount}`);
      return;
    } catch {
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const createJob = (accountId, tx) => post(BASE, { network: 'testnet', accountId, txXdr: tx.toXDR() });

test('txSourceBaseAccount: G-Adresse, M-Adresse und ungueltige Quelle', () => {
  const base = Keypair.random().publicKey();
  assert.equal(txSourceBaseAccount(paymentTx(new Account(base, '1'))), base);
  assert.equal(txSourceBaseAccount(paymentTx(new MuxedAccount(new Account(base, '1'), '7'))), base);
  assert.equal(txSourceBaseAccount({ source: 'kaputt' }), null);
  assert.equal(txSourceBaseAccount(null), null);
});

test('Create: abweichende Quelle wird mit account_mismatch abgelehnt (Szenario K1)', async () => {
  const { status, body } = await createJob(attackerAccount, victimTx);
  assert.equal(status, 400);
  assert.deepEqual(body, { ok: false, error: 'account_mismatch', detail: 'Transaction source does not match accountId.' });
});

test('Create: accountId muss eine gueltige G-Adresse sein', async () => {
  const muxed = paymentTx(new MuxedAccount(new Account(victim.publicKey(), '100'), '7'));
  for (const accountId of ['', 'kaputt', 42, muxed.source, `${victim.publicKey().slice(0, -1)}A`]) {
    const { status, body } = await createJob(accountId, victimTx);
    assert.equal(status, 400, String(accountId));
    assert.equal(body.error, 'invalid_account', String(accountId));
  }
});

test('Create: M-Adresse als Quelle mit gleichem Basiskonto wird angenommen', async () => {
  const base = Keypair.random().publicKey();
  const { status, body } = await createJob(base, paymentTx(new MuxedAccount(new Account(base, '100'), '7')));
  assert.equal(status, 200);
  assert.equal(body.accountId, base);
  assert.equal(body.status, 'pending_signatures');
});

test('Create: M-Adresse mit anderem Basiskonto wird abgelehnt', async () => {
  const { status, body } = await createJob(attackerAccount, paymentTx(new MuxedAccount(new Account(victim.publicKey(), '100'), '7')));
  assert.equal(status, 400);
  assert.equal(body.error, 'account_mismatch');
});

test('Merge: Altjob mit Abweichung lehnt ab und bleibt unveraendert gespeichert', async () => {
  const signed = TransactionBuilder.fromXDR(victimTx.toXDR(), Networks.TESTNET);
  signed.sign(victim);
  const { status, body } = await post(`${BASE}/legacy-mismatch/merge-signed-xdr`, { signedXdr: signed.toXDR() }, { 'x-job-token': 'legacy-token' });
  assert.equal(status, 400);
  assert.equal(body.error, 'account_mismatch');

  const res = await fetch(`${BASE}/legacy-mismatch`, { headers: { 'x-job-token': 'legacy-token' } });
  const stored = await res.json();
  assert.equal(stored.txXdrCurrent, victimTx.toXDR());
  assert.equal(stored.collectedWeight, 0);
});

test('Merge: passender Job kommt an der Pruefung vorbei', async () => {
  const owner = Keypair.random();
  const tx = paymentTx(new Account(owner.publicKey(), '100'));
  const created = await createJob(owner.publicKey(), tx);
  assert.equal(created.status, 200);
  const signed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
  signed.sign(owner);
  const { status, body } = await post(`${BASE}/${created.body.id}/merge-signed-xdr`, { signedXdr: signed.toXDR() }, { 'x-job-token': created.body.accessToken });
  // Das Konto existiert nicht, der Merge endet deshalb erst bei der Signer-Abfrage.
  assert.equal(status, 502);
  assert.equal(body.error, 'signers_unavailable');
});

test('Merge: mismatched_hash kommt vor account_mismatch', async () => {
  const otherTx = paymentTx(new Account(victim.publicKey(), '101'));
  const { status, body } = await post(`${BASE}/legacy-mismatch/merge-signed-xdr`, { signedXdr: otherTx.toXDR() }, { 'x-job-token': 'legacy-token' });
  assert.equal(status, 400);
  assert.equal(body.error, 'mismatched_hash');
});

// Node parst nur einfache Transaktionen: Ein Fee-Bump endet beim Anlegen und beim Merge als
// invalid_xdr, noch vor der Konto-Pruefung. PHP verhaelt sich anders, siehe Pendant.
test('Fee-Bump: Create und Merge lehnen als invalid_xdr ab', async () => {
  const owner = Keypair.random();
  const inner = paymentTx(new Account(owner.publicKey(), '100'));
  inner.sign(owner);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), '2000', inner, Networks.TESTNET);

  for (const accountId of [owner.publicKey(), attackerAccount]) {
    const { status, body } = await createJob(accountId, feeBump);
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_xdr');
  }

  const created = await createJob(owner.publicKey(), inner);
  assert.equal(created.status, 200);
  const merged = await post(`${BASE}/${created.body.id}/merge-signed-xdr`, { signedXdr: feeBump.toXDR() }, { 'x-job-token': created.body.accessToken });
  assert.equal(merged.status, 400);
  assert.equal(merged.body.error, 'invalid_xdr');
});
