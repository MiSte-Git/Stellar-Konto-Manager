// R-1 (review_challenge_opus.md): signer und signature nur als String (Node). Faelle aus
// test/assets/challenge-cases.json (bodyTypes), gleich in test/challengeBodyTypes.test.php.
// Vorher machte Node aus ['G...'] per String() einen gueltigen Key und aus [signatur] eine
// gueltige Signatur, PHP lehnte ab. Eigene Datei und eigener Server: test/challengeCases.test.js
// braucht schon 17 der 20 POST /challenge je Minute und IP, diese Datei braucht 5.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { challengeMessage } = require('../services/challengeStore.js');
const cases = require('./assets/challenge-cases.json');

const PORT = 3968;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;

const owner = Keypair.random();
const signer = Keypair.random();
const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();

let server;
let dataDir;

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const sign = (kp, nonce, purpose) => Buffer.from(kp.sign(challengeMessage(nonce, purpose))).toString('base64');
// "$VALID" in der Fixture durch einen gueltigen Wert ersetzen, auch in Listen und Objekten.
const fill = (value, valid) => {
  if (value === '$VALID') return valid;
  if (Array.isArray(value)) return value.map((v) => fill(v, valid));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, valid)]));
  return value;
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-challenge-types-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [{
    id: 'typen', accessToken: 'tok-typen', network: 'testnet', accountId: owner.publicKey(),
    txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
    status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
    signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
  }] }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }, { key: signer.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}/typen`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('signer ohne String -> 400 invalid_signer an challenge, token, decline, delete', async () => {
  const nonce = Buffer.alloc(32).toString('base64');
  for (const c of cases.bodyTypes.values) {
    const value = fill(c.value, signer.publicKey());
    const res = await post(`${BASE}/typen/challenge`, { signer: value });
    assert.equal(res.status, 400, `challenge: ${c.label}`);
    assert.equal(res.body.error, 'invalid_signer', `challenge: ${c.label}`);
    for (const action of ['token', 'decline', 'delete']) {
      const r = await post(`${BASE}/typen/${action}`, { signer: value, signature: sign(signer, nonce, action), challenge: nonce });
      assert.equal(r.status, 400, `${action}: ${c.label}`);
      assert.equal(r.body.error, 'invalid_signer', `${action}: ${c.label}`);
    }
  }
});

test('signature ohne String -> 400 missing_signature an token, decline, delete, die Nonce bleibt offen', async () => {
  const { body: ch } = await post(`${BASE}/typen/challenge`, { signer: signer.publicKey() });
  for (const c of cases.bodyTypes.values) {
    for (const action of ['token', 'decline', 'delete']) {
      const value = fill(c.value, sign(signer, ch.challenge, action));
      const r = await post(`${BASE}/typen/${action}`, { signer: signer.publicKey(), signature: value, challenge: ch.challenge });
      assert.equal(r.status, 400, `${action}: ${c.label}`);
      assert.equal(r.body.error, 'missing_signature', `${action}: ${c.label}`);
    }
  }
  const res = await post(`${BASE}/typen/token`, { signer: signer.publicKey(), signature: sign(signer, ch.challenge, 'token'), challenge: ch.challenge });
  assert.equal(res.status, 200);
  assert.equal(res.body.accessToken, 'tok-typen');
});
