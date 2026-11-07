// C1/R3: Loeschen in allen Endzustaenden (submitted_success, submitted_failed, obsolete_seq)
// und mit abgelaufener Challenge (Node). test/multisigDelete.test.js deckt expired, rejected
// und offene Jobs ab. Die Uhr des Servers wird per test/helpers/clockOffsetMock.js
// vorgestellt, damit die Challenge (60 s) ablaeuft. Budget: 5 Challenges von 20 je Minute.
// Pendant: test/multisigDeleteStates.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3936;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const b = Keypair.random();

const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
const job = (id, status) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status, createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }, { publicKey: b.publicKey(), weight: 1 }],
  requiredWeight: 2, collectedSigners: [], collectedWeight: 0,
});

let server;
let dataDir;
let dbPath;
let clockPath;
const storedIds = () => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.map((j) => j.id);
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const challengeFor = async (jobId, kp) => (await post(`${BASE}/${jobId}/challenge`, { signer: kp.publicKey() })).body.challenge;
const deleteWith = (jobId, kp, challenge, purpose = 'delete') => post(`${BASE}/${jobId}/delete`, {
  signer: kp.publicKey(),
  signature: Buffer.from(kp.sign(Buffer.concat([Buffer.from(`skm:${purpose}:`), Buffer.from(challenge, 'base64')]))).toString('base64'),
});

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-states-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  clockPath = path.join(dataDir, 'clock_offset.txt');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(clockPath, '0');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [
    job('gesendet', 'submitted_success'), job('fehlgeschlagen', 'submitted_failed'),
    job('veraltet', 'obsolete_seq'), job('zeit', 'expired'),
  ] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }, { key: b.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', '--require', './test/helpers/clockOffsetMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath,
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_CLOCK_OFFSET_FILE: clockPath,
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
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Abgelaufene Challenge mit gueltiger delete-Signatur -> 400 challenge_missing_or_expired, Job bleibt', async () => {
  const challenge = await challengeFor('zeit', b);
  fs.writeFileSync(clockPath, '61'); // TTL der Challenge ist 60 s
  const res = await deleteWith('zeit', b, challenge);
  fs.writeFileSync(clockPath, '0');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  assert.ok(storedIds().includes('zeit'));
  // Gegenprobe: eine frische Challenge desselben Signers funktioniert.
  const fresh = await deleteWith('zeit', b, await challengeFor('zeit', b));
  assert.equal(fresh.status, 200);
  assert.ok(!storedIds().includes('zeit'));
});

for (const [id, status] of [['gesendet', 'submitted_success'], ['fehlgeschlagen', 'submitted_failed'], ['veraltet', 'obsolete_seq']]) {
  test(`Loeschen im Endzustand ${status} -> 200, Job entfernt`, async () => {
    assert.ok(storedIds().includes(id));
    const res = await deleteWith(id, b, await challengeFor(id, b));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(!storedIds().includes(id));
  });
}
