// Job-Datenmodell mit Signer-Typ (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 5), Node.
// Jobs speichern signers[].type aus Horizon; missingSigners (Paritaet mit PHP summarizeJob, #16)
// nennt nur Signer, die signieren koennen. Horizon kommt aus test/helpers/horizonAccountsMock.js.
// Pendant: test/multisigSignerType.test.php. Port 3944 (PHP 3945), frei in der Liste der Test-Ports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3944;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const b = Keypair.random();
const X = StrKey.encodeSha256Hash(Buffer.alloc(32, 2));
// Konto des Altjobs: fehlt im Horizon-Mock (= Horizon nicht erreichbar). Offene Jobs werden sonst
// beim Lesen live neu berechnet (F-11); der gespeicherte Stand ohne Typ gilt nur bei Ausfall.
const legacyOwner = Keypair.random();

function buildTx(source = owner) {
  return new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
}

let server;
let dataDir;
let dbPath;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-signertype-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  // Altjob ohne Signer-Typ (Stand vor Teilschritt 5), Horizon fuer sein Konto nicht erreichbar
  const oldTx = buildTx(legacyOwner);
  fs.writeFileSync(dbPath, JSON.stringify({ items: [{
    id: 'altjob', accessToken: 'tok-alt', network: 'testnet', accountId: legacyOwner.publicKey(),
    txHash: Buffer.from(oldTx.hash()).toString('hex'), txXdrOriginal: oldTx.toXDR(), txXdrCurrent: oldTx.toXDR(),
    status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
    signers: [{ publicKey: legacyOwner.publicKey(), weight: 1 }, { publicKey: X, weight: 1 }],
    requiredWeight: 2, collectedSigners: [], collectedWeight: 0,
  }] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [
        { key: owner.publicKey(), weight: 1, type: 'ed25519_public_key' },
        { key: b.publicKey(), weight: 1, type: 'ed25519_public_key' },
        { key: X, weight: 1, type: 'sha256_hash' },
      ],
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath },
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

test('Job anlegen: signers mit Typ aus Horizon gespeichert', async () => {
  const tx = buildTx();
  tx.sign(owner);
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'testnet', accountId: owner.publicKey(), txXdr: tx.toXDR() }),
  });
  assert.equal(res.status, 200);
  const job = await res.json();
  const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === job.id);
  assert.deepEqual(stored.signers, [
    { publicKey: owner.publicKey(), weight: 1, type: 'ed25519_public_key' },
    { publicKey: b.publicKey(), weight: 1, type: 'ed25519_public_key' },
    { publicKey: X, weight: 1, type: 'sha256_hash' },
  ]);
  assert.deepEqual(stored.collectedSigners, [{ publicKey: owner.publicKey(), weight: 1 }]);

  // missingSigners: nur b; der Hash-Signer kann nie signieren und fehlt deshalb nicht
  const detail = await (await fetch(`${BASE}/${job.id}`, { headers: { 'x-job-token': job.accessToken } })).json();
  assert.deepEqual(detail.missingSigners, [{ publicKey: b.publicKey(), weight: 1, type: 'ed25519_public_key' }]);
  assert.equal(detail.missingWeight, 1);
  // Liste: dieselben Felder, ohne Token und XDR
  const list = await (await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`)).json();
  const item = list.find((j) => j.id === job.id);
  assert.equal(item.accessToken, undefined);
  assert.deepEqual(item.missingSigners.map((s) => s.publicKey), [b.publicKey()]);
});

test('Altjob ohne Signer-Typ wird gelesen (gespeicherter Stand bei Horizon-Ausfall), der Typ folgt aus dem Schluessel', async () => {
  const detail = await (await fetch(`${BASE}/altjob`, { headers: { 'x-job-token': 'tok-alt' } })).json();
  assert.deepEqual(detail.missingSigners, [{ publicKey: legacyOwner.publicKey(), weight: 1 }]);
  assert.equal(detail.missingWeight, 1);
});
