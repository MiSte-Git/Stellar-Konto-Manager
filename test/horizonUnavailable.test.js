// R1/R2 (Node): Token, Ablehnen und Loeschen unterscheiden "Konto unbekannt" (Horizon 404 ->
// 403 forbidden, niemand ist Signer) von "Horizon nicht erreichbar" (-> 503 horizon_unavailable;
// vorher beides 403 und die UI sagte "kein Signer"). Ein haengendes Horizon beendet die Abfrage
// nach HORIZON_LOAD_TIMEOUT_MS und haelt den Job-Lock nicht fest. Horizon wird per
// test/helpers/horizonAccountsMock.js ersetzt. Budget: 8 Challenges von 20 je Minute.
// Pendant: test/horizonUnavailable.test.php (ohne Timeout-Lauf, dort nur Quelltext-Pruefung).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3938;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const signer = Keypair.random();
const down = Keypair.random().publicKey(); // dem Mock unbekannt: Fehler ohne HTTP-Status
const gone = Keypair.random().publicKey(); // Mock wirft 404 wie Horizon
const hang = Keypair.random().publicKey(); // Mock antwortet nie

const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
const job = (id, accountId, status = 'expired') => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId,
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status, createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: signer.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
});

let server;
let dataDir;
let dbPath;
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const call = async (jobId, action, purpose) => {
  const { body: ch } = await post(`${BASE}/${jobId}/challenge`, { signer: signer.publicKey() });
  const nonce = Buffer.from(ch.challenge, 'base64');
  const signature = Buffer.from(signer.sign(Buffer.concat([Buffer.from(`skm:${purpose}:`), nonce]))).toString('base64');
  return post(`${BASE}/${jobId}/${action}`, { signer: signer.publicKey(), signature });
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-horizon-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: [job('j-down', down), job('j-gone', gone), job('j-hang', hang)] }));
  fs.writeFileSync(accountsPath, JSON.stringify({ [gone]: { notFound: true }, [hang]: { hang: true } }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath,
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, HORIZON_LOAD_TIMEOUT_MS: '400',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${down}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ROUTES = [['token', 'token'], ['decline', 'decline'], ['delete', 'delete']];

for (const [action, purpose] of ROUTES) {
  test(`${action}: Horizon nicht erreichbar -> 503 horizon_unavailable, nichts veraendert`, async () => {
    const res = await call('j-down', action, purpose);
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false, error: 'horizon_unavailable' });
    assert.ok(JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.some((j) => j.id === 'j-down'));
  });
  test(`${action}: Konto bei Horizon unbekannt (404) -> 403 forbidden, wie "kein Signer"`, async () => {
    const res = await call('j-gone', action, purpose);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  });
}

test('R1: haengendes Horizon -> 503 nach dem Timeout, der Job-Lock bleibt frei', async () => {
  const started = Date.now();
  const first = await call('j-hang', 'delete', 'delete');
  assert.equal(first.status, 503);
  assert.equal(first.body.error, 'horizon_unavailable');
  assert.ok(Date.now() - started < 5000, 'Antwort kommt nach dem Timeout, nicht nie');
  // Der Lock des Jobs ist frei: die naechste Anfrage wird ebenfalls beantwortet.
  const second = await call('j-hang', 'decline', 'decline');
  assert.equal(second.status, 503);
});
