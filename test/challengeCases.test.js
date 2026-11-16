// Offene Challenges eines Signers duerfen Dritte weder ueberschreiben noch verbrauchen (Node).
// Faelle aus test/assets/challenge-cases.json, gleich in test/challengeCases.test.php. Echter
// HTTP-Test gegen server.js: Challenges holen, mit Nonce im Feld `challenge` gegen das Token
// einloesen. Frueher gab es je (jobId, signer) genau eine Challenge, POST /challenge ersetzte
// sie und token, decline, delete verbrauchten sie ohne Nonce im Body; die Szenarien (a), (b)
// und (e) schlagen mit dem alten Verhalten fehl. Horizon per test/helpers/horizonAccountsMock.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { challengeMessage } = require('../services/challengeStore.js');
const cases = require('./assets/challenge-cases.json');

const PORT = 3966;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;

const owner = Keypair.random();
const keys = { S1: Keypair.random(), S2: Keypair.random() };
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
const OUTCOME = { 200: 'ok', 400: 'missing', 403: 'invalid_signature' };

const job = (id, status) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status, createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
});

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-challenge-cases-'));
  const dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  // Je Szenario eigene Jobs, damit sich die Faelle nicht gegenseitig beeinflussen.
  const items = [job('body', 'pending_signatures')];
  cases.scenarios.forEach((_, i) => items.push(job(`s${i}-j1`, 'pending_signatures'), job(`s${i}-j2`, 'pending_signatures')));
  fs.writeFileSync(dbPath, JSON.stringify({ items }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }, { key: keys.S1.publicKey(), weight: 1 }, { key: keys.S2.publicKey(), weight: 1 }],
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
    try { await fetch(`${BASE}/body`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

cases.scenarios.forEach((scenario, index) => {
  test(`Fixture: ${scenario.name}`, async () => {
    const jobs = { j1: `s${index}-j1`, j2: `s${index}-j2` };
    const nonces = {};
    for (const [i, step] of scenario.steps.entries()) {
      const pk = keys[step.signer].publicKey();
      if (step.op === 'create') {
        const res = await post(`${BASE}/${jobs[step.job]}/challenge`, { signer: pk });
        assert.equal(res.status, 200, `Schritt ${i + 1}: Challenge`);
        nonces[step.nonce] = res.body.challenge;
        continue;
      }
      const nonce = nonces[step.nonce];
      const signWith = step.sign === 'valid' ? keys[step.signer] : Keypair.random();
      const res = await post(`${BASE}/${jobs[step.job]}/token`, { signer: pk, signature: sign(signWith, nonce, 'token'), challenge: nonce });
      assert.equal(OUTCOME[res.status], step.expect, `Schritt ${i + 1} (${step.nonce} fuer ${step.job}/${step.signer}): ${res.status} ${res.body.error || ''}`);
      if (step.expect === 'missing') assert.equal(res.body.error, 'challenge_missing_or_expired');
      if (step.expect === 'invalid_signature') assert.equal(res.body.error, 'invalid_signature');
      if (step.expect === 'ok') assert.equal(res.body.accessToken, `tok-${jobs[step.job]}`);
    }
  });
});

test('(f) fehlende oder kaputte Nonce im Body -> 400 challenge_missing_or_expired, die offene Challenge bleibt', async () => {
  const kp = keys.S1;
  const { body: ch } = await post(`${BASE}/body/challenge`, { signer: kp.publicKey() });
  const signature = sign(kp, ch.challenge, 'token');
  for (const c of cases.bodyNonces) {
    const body = { signer: kp.publicKey(), signature };
    if (!c.omit) body.challenge = c.value;
    const res = await post(`${BASE}/body/token`, body);
    assert.equal(res.status, 400, c.label);
    assert.equal(res.body.error, 'challenge_missing_or_expired', c.label);
  }
  // Ablehnen und Loeschen pruefen die Nonce genauso (Stichprobe, Rate-Limit der Datei schonen).
  for (const action of ['decline', 'delete']) {
    for (const c of cases.bodyNonces.filter((x) => ['fehlt', '22 Byte (F-6)', 'gueltig, aber unbekannt'].includes(x.label))) {
      const body = { signer: kp.publicKey(), signature: sign(kp, ch.challenge, action) };
      if (!c.omit) body.challenge = c.value;
      const res = await post(`${BASE}/body/${action}`, body);
      assert.equal(res.status, 400, `${action}: ${c.label}`);
      assert.equal(res.body.error, 'challenge_missing_or_expired', `${action}: ${c.label}`);
    }
  }
  const res = await post(`${BASE}/body/token`, { signer: kp.publicKey(), signature, challenge: ch.challenge });
  assert.equal(res.status, 200);
  assert.equal(res.body.accessToken, 'tok-body');
});

test('Ablehnen und Loeschen verbrauchen nur die mitgeschickte Nonce, eine zweite des Signers bleibt', async () => {
  const kp = keys.S2;
  const first = (await post(`${BASE}/body/challenge`, { signer: kp.publicKey() })).body.challenge;
  const second = (await post(`${BASE}/body/challenge`, { signer: kp.publicKey() })).body.challenge;
  // Falsche Signatur fuer delete mit der ersten Nonce: verbraucht nur diese.
  let res = await post(`${BASE}/body/delete`, { signer: kp.publicKey(), signature: sign(Keypair.random(), first, 'delete'), challenge: first });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'invalid_signature');
  res = await post(`${BASE}/body/decline`, { signer: kp.publicKey(), signature: sign(kp, first, 'decline'), challenge: first });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'challenge_missing_or_expired');
  res = await post(`${BASE}/body/decline`, { signer: kp.publicKey(), signature: sign(kp, second, 'decline'), challenge: second });
  assert.equal(res.status, 200);
});
