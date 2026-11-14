// F-5 (Node): Ein Signer mit Job-Token mergt eine zweite, andere gueltige Signatur seines Keys
// (anderes Nonce). Gespeichert bleibt je Signer nur eine Signatur (die schon gespeicherte), sonst
// lehnt das Netz die Transaktion spaeter mit tx_bad_auth_extra ab. Fixture
// test/assets/duplicate-signer-signatures.json, Horizon per test/helpers/horizonAccountsMock.js
// (A und B je Gewicht 1, Schwelle 2: es wird nicht gesendet). Pendant: test/duplicateSignerMerge.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Keypair, Networks, TransactionBuilder, xdr } = require('@stellar/stellar-sdk');
const { decoratedSignatureBytes } = require('../services/txSignatures.js');
const dup = require('./assets/duplicate-signer-signatures.json');

const PORT = 3949;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const a = Keypair.fromPublicKey(dup.publicKeyA);
const sig = (b64) => new xdr.DecoratedSignature({ hint: a.signatureHint(), signature: Buffer.from(b64, 'base64') });
const withSigs = (list) => {
  const tx = TransactionBuilder.fromXDR(dup.txXdr, Networks.TESTNET);
  list.forEach((b64) => tx.signatures.push(sig(b64)));
  return tx.toXDR();
};

let server;
let dataDir;
let dbPath;
const storedSignatures = () => {
  const job = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === 'dup-job');
  return TransactionBuilder.fromXDR(job.txXdrCurrent, Networks.TESTNET).signatures.map((s) => Buffer.from(decoratedSignatureBytes(s).signature).toString('base64'));
};
const merge = async (signedXdr) => {
  const res = await fetch(`${BASE}/dup-job/merge-signed-xdr`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-job-token': 'tok-dup' }, body: JSON.stringify({ signedXdr }),
  });
  return { status: res.status, body: await res.json() };
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-dupsig-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [{
    id: 'dup-job', accessToken: 'tok-dup', network: 'testnet', accountId: dup.publicKeyA, txHash: dup.txHashHex,
    txXdrOriginal: dup.txXdr, txXdrCurrent: withSigs([dup.signatureA1]), status: 'pending_signatures',
    createdAt: new Date().toISOString(), maxTimeUnix: 0,
    signers: [{ publicKey: dup.publicKeyA, weight: 1 }, { publicKey: dup.publicKeyB, weight: 1 }],
    requiredWeight: 2, collectedSigners: [{ publicKey: dup.publicKeyA, weight: 1 }], collectedWeight: 1,
  }] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [dup.publicKeyA]: {
      signers: [{ key: dup.publicKeyA, weight: 1 }, { key: dup.publicKeyB, weight: 1 }],
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
    try { await fetch(`${BASE}?network=testnet&accountId=${dup.publicKeyA}`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Merge einer zweiten Signatur desselben Signers: gespeichert bleibt nur die erste', async () => {
  const res = await merge(withSigs([dup.signatureA2]));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'pending_signatures');
  assert.equal(res.body.collectedWeight, 1);
  assert.deepEqual(storedSignatures(), [dup.signatureA1]);
});

test('Merge mit beiden Signaturen auf einmal: weiterhin nur eine', async () => {
  const res = await merge(withSigs([dup.signatureA2, dup.signatureA1]));
  assert.equal(res.status, 200);
  assert.deepEqual(storedSignatures(), [dup.signatureA1]);
});
